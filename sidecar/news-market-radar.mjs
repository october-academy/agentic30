import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import {
  adaptiveLocaleSourceScore,
  adaptiveTextRelevanceScore,
  buildAdaptiveResearchProfile,
} from "./adaptive-research-profile.mjs";
import {
  annotateMarketRadarSourceTrust,
  buildTrustedSourceQueriesForLane,
  trustedSourcesForMarketRadarPrompt,
} from "./market-radar-source-catalog.mjs";
import { sanitizeWebSearchQuery } from "./read-only-workspace-tool-policy.mjs";

export const NEWS_MARKET_RADAR_SCHEMA_VERSION = 1;
export const NEWS_MARKET_RADAR_CACHE_SCHEMA_VERSION = 1;
export const CURRICULUM_ANSWER_LOG_SCHEMA_VERSION = 1;
export const NEWS_MARKET_RADAR_RETENTION_DAYS = 30;
export const NEWS_MARKET_RADAR_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const NEWS_MARKET_RADAR_DEFAULT_PROVIDER_TIMEOUT_MS = 240_000;
export const NEWS_MARKET_RADAR_CONTENT_LOCALE = "ko-KR";
export const NEWS_MARKET_RADAR_PROMPT_PROFILE = "ko_market_radar_v6_adaptive_context_trusted_sources_no_self_sources";
export const NEWS_MARKET_RADAR_LANE_CONCURRENCY = 5;
export const NEWS_MARKET_RADAR_MAX_CARDS_PER_LANE = 4;
export const NEWS_MARKET_RADAR_EXA_MCP_TOOLS = Object.freeze([
  "web_search_advanced_exa",
  "web_fetch_exa",
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_SOURCE_WINDOW_MS = 18 * 31 * DAY_MS;
const MAX_EVIDENCE_CHARS_PER_DOC = 12_000;
const MAX_ANSWER_CHARS = 2_000;
const MAX_PROVIDER_PROMPT_CHARS = 40_000;
const NEWS_LANE_IDS = Object.freeze([
  "icp",
  "problem",
  "alternatives_pricing",
  "channel",
  "platform",
]);

const SELF_REFERENCE_STOP_TERMS = new Set([
  "app",
  "application",
  "assistant",
  "coach",
  "demo",
  "local",
  "mac",
  "market",
  "private",
  "product",
  "project",
  "public",
  "research",
  "sidecar",
  "workspace",
]);

const MARKET_RADAR_BUYING_SIGNAL_PATTERN = /(pricing|price|reviews?|alternatives?|compare|comparison|vs|plans?|lifetime|deal|checkout|purchase|buying|budget|결제|가격|리뷰|대안|구매|예산|요금)/i;

export const NEWS_MARKET_RADAR_PROGRESS_STEPS = Object.freeze([
  {
    stage: "checking_exa_route",
    stepIndex: 1,
    progressText: "Exa MCP 연결을 확인하는 중",
  },
  {
    stage: "loading_workspace_evidence",
    stepIndex: 2,
    progressText: "워크스페이스 근거와 일차 답변을 읽는 중",
  },
  {
    stage: "building_research_prompt",
    stepIndex: 3,
    progressText: "리서치 질문을 구성하는 중",
  },
  {
    stage: "running_provider_research",
    stepIndex: 4,
    progressText: "프로바이더 Exa MCP로 공개 근거를 검색하는 중",
  },
  {
    stage: "normalizing_cards",
    stepIndex: 5,
    progressText: "근거를 가정별 카드로 정리하는 중",
  },
  {
    stage: "saving_results",
    stepIndex: 6,
    progressText: "리서치 결과를 로컬 캐시에 저장하는 중",
  },
]);

const NEWS_MARKET_RADAR_PROGRESS_BY_STAGE = new Map(
  NEWS_MARKET_RADAR_PROGRESS_STEPS.map((step) => [step.stage, step]),
);

export function normalizeNewsMarketRadarProviderTimeout(
  value,
  {
    defaultMs = NEWS_MARKET_RADAR_DEFAULT_PROVIDER_TIMEOUT_MS,
    minMs = 30_000,
    maxMs = 600_000,
  } = {},
) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return defaultMs;
  return Math.max(minMs, Math.min(parsed, maxMs));
}

export function formatNewsMarketRadarProviderTimeout(timeoutMs) {
  if (timeoutMs < 60_000) return `${Math.round(timeoutMs / 1000)}s`;
  const minutes = timeoutMs / 60_000;
  return Number.isInteger(minutes) ? `${minutes}m` : `${Math.round(timeoutMs / 1000)}s`;
}

export function buildNewsMarketRadarProgressStatus(progress = {}, {
  reason = "manual",
  startedAt = null,
  researchSource = null,
  stale = false,
  nowMs = Date.now(),
} = {}) {
  const stage = cleanString(progress.stage || "checking_exa_route", 120) || "checking_exa_route";
  const step = NEWS_MARKET_RADAR_PROGRESS_BY_STAGE.get(stage) || null;
  const startedAtMs = Number.isFinite(startedAt) ? startedAt : null;
  const elapsedMs = startedAtMs !== null
    ? Math.max(0, Math.round(nowMs - startedAtMs))
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
    stepCount: Number.isFinite(progress.stepCount)
      ? progress.stepCount
      : NEWS_MARKET_RADAR_PROGRESS_STEPS.length,
    partialFailures: normalizePartialFailures(progress.partialFailures || progress.partial_failures),
  };
}

const NEWS_LANE_TITLES = Object.freeze({
  icp: "ICP",
  problem: "문제",
  alternatives_pricing: "대안/가격",
  channel: "채널",
  platform: "플랫폼",
});

const NEWS_LANE_HYPOTHESES = Object.freeze({
  icp: "누가 가장 절박한 사용자인가",
  problem: "그들이 실제로 겪는 비용/마찰은 무엇인가",
  alternatives_pricing: "이미 돈을 쓰는 대안과 가격 기준은 무엇인가",
  channel: "어디서 발견하고 설득할 수 있는가",
  platform: "어떤 제품/스토어/배포 제약이 있는가",
});

const WORKSPACE_EVIDENCE_CANDIDATES = Object.freeze([
  { role: "icp", relativePath: "docs/ICP.md", title: "ICP.md" },
  { role: "icp", relativePath: "ICP.md", title: "ICP.md" },
  { role: "spec", relativePath: "docs/SPEC.md", title: "SPEC.md" },
  { role: "spec", relativePath: "SPEC.md", title: "SPEC.md" },
  { role: "goal", relativePath: "docs/GOAL.md", title: "GOAL.md" },
  { role: "goal", relativePath: "GOAL.md", title: "GOAL.md" },
  { role: "values", relativePath: "docs/VALUES.md", title: "VALUES.md" },
  { role: "values", relativePath: "VALUES.md", title: "VALUES.md" },
  { role: "readme", relativePath: "README.md", title: "README.md" },
  { role: "foundation", relativePath: ".agentic30/foundation-summary.json", title: "foundation-summary" },
  { role: "foundation", relativePath: ".agentic30/foundation-summary.md", title: "foundation-summary" },
]);

const DENIED_PATH_SEGMENTS = new Set([
  ".git",
  ".env",
  ".ssh",
  "node_modules",
  ".keychain",
  ".aws",
  ".gnupg",
]);

const SECRETISH_FILENAME_PATTERN = /(^|[._-])(secret|token|credential|password|key)([._-]|$)/i;
const SECRET_TOKEN_PATTERNS = Object.freeze([
  /sk-[A-Za-z0-9_\-]{20,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /xox[baprs]-[A-Za-z0-9_-]{10,}/g,
  /AIza[A-Za-z0-9_\-]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
]);

export function resolveAgentic30Dir(workspaceRoot) {
  return path.join(path.resolve(String(workspaceRoot || ".")), ".agentic30");
}

export function resolveAgentic30MemoryDir(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "memory");
}

export function resolveCurriculumAnswerLogPath(workspaceRoot) {
  return path.join(resolveAgentic30MemoryDir(workspaceRoot), "curriculum-answers.json");
}

export function resolveNewsMarketRadarCachePath(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "news", "market-radar-cache.json");
}

export function resolveNewsMarketRadarRunsDir(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "news", "runs");
}

export function buildExaMcpConfig(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) return null;
  return {
    type: "http",
    url: marketRadarExaMcpUrl(),
    headers: {
      "x-api-key": key,
    },
  };
}

function marketRadarExaMcpUrl(rawUrl = "https://mcp.exa.ai/mcp") {
  return ensureExaMcpAdvancedTools(rawUrl, NEWS_MARKET_RADAR_EXA_MCP_TOOLS);
}

function ensureExaMcpAdvancedTools(rawUrl = "", requiredTools = NEWS_MARKET_RADAR_EXA_MCP_TOOLS) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    if (normalizeDomain(parsed.hostname) !== "mcp.exa.ai" || parsed.pathname.replace(/\/+$/, "") !== "/mcp") {
      return String(rawUrl || "");
    }
    const existingTools = (parsed.searchParams.get("tools") || "")
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);
    const tools = [...new Set([...existingTools, ...requiredTools])];
    parsed.searchParams.set("tools", tools.join(","));
    return parsed.toString().replace(/%2C/g, ",");
  } catch {
    return String(rawUrl || "");
  }
}

export function redactPrivateQueryText(value) {
  let text = String(value || "");
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    text = text.replace(pattern, "[REDACTED]");
  }
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

export function normalizeCurriculumAnswer(input = {}, { now = new Date() } = {}) {
  const day = clampInt(input.day ?? input.dayNumber, 1, 30, null);
  if (!day) return null;
  const occurredAt = normalizeIsoDate(input.occurredAt ?? input.createdAt, now);
  const question = objectOrEmpty(input.question);
  const answer = objectOrEmpty(input.answer);
  const questionId = cleanString(
    input.questionId ?? input.questionID ?? question.id ?? `day-${day}-question`,
    120,
  );
  const answerId = cleanString(input.answerId ?? input.answerID ?? answer.id ?? "", 120);
  const questionTitle = cleanString(input.questionTitle ?? question.title ?? input.title ?? "", 300);
  const questionPrompt = cleanString(input.questionPrompt ?? question.prompt ?? input.prompt ?? "", 1_500);
  const answerTitle = cleanString(input.answerTitle ?? answer.title ?? input.choice ?? "", 500);
  const answerDetail = cleanString(input.answerDetail ?? answer.detail ?? "", 1_000);
  const freeformAnswer = cleanString(input.freeformAnswer ?? input.freeform ?? answer.freeform ?? "", MAX_ANSWER_CHARS);
  return {
    id: cleanString(input.id ?? `day-${day}-${questionId}-${Date.parse(occurredAt) || now.getTime()}`, 180),
    schemaVersion: CURRICULUM_ANSWER_LOG_SCHEMA_VERSION,
    day,
    dayType: cleanString(input.dayType ?? input.day_type ?? "", 80),
    questionId,
    dimension: cleanString(input.dimension ?? question.dimension ?? "", 120),
    questionTitle,
    questionPrompt,
    answerId,
    answerTitle,
    answerDetail,
    freeformAnswer,
    isAntiSignal: Boolean(input.isAntiSignal ?? input.is_anti_signal ?? answer.isAntiSignal),
    occurredAt,
  };
}

export async function appendCurriculumAnswer({
  workspaceRoot,
  answer,
  now = new Date(),
  fsImpl = fs,
} = {}) {
  const normalized = normalizeCurriculumAnswer(answer, { now });
  if (!normalized) {
    throw new Error("curriculum_answer_saved requires a day between 1 and 30.");
  }
  const filePath = resolveCurriculumAnswerLogPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const previous = await loadCurriculumAnswerLog({ workspaceRoot, now, fsImpl, prune: false });
    const records = pruneRecordsByRetention([...previous.records, normalized], {
      now,
      dateKey: "occurredAt",
    });
    const payload = {
      schemaVersion: CURRICULUM_ANSWER_LOG_SCHEMA_VERSION,
      updatedAt: now.toISOString(),
      records,
    };
    await atomicWriteJson(filePath, payload);
    return payload;
  });
}

export async function loadCurriculumAnswerLog({
  workspaceRoot,
  now = new Date(),
  fsImpl = fs,
  prune = true,
} = {}) {
  const filePath = resolveCurriculumAnswerLogPath(workspaceRoot);
  const raw = await readJsonFile(filePath, fsImpl);
  const records = Array.isArray(raw?.records)
    ? raw.records
        .map((record) => normalizeCurriculumAnswer(record, { now }))
        .filter(Boolean)
    : [];
  const prunedRecords = prune
    ? pruneRecordsByRetention(records, { now, dateKey: "occurredAt" })
    : records;
  return {
    schemaVersion: CURRICULUM_ANSWER_LOG_SCHEMA_VERSION,
    updatedAt: raw?.updatedAt || null,
    records: prunedRecords,
  };
}

export function rankAnswersForMarketRadar(records = [], { now = new Date() } = {}) {
  const nowMs = now.getTime();
  const coreDimensions = new Set([
    "icp",
    "pain",
    "problem",
    "market",
    "pricing",
    "alternatives",
    "current_alternative",
    "bad_fit_boundary",
    "platform",
    "channel",
  ]);
  return records
    .map((record) => {
      const ageDays = Number.isFinite(Date.parse(record.occurredAt))
        ? Math.max(0, Math.floor((nowMs - Date.parse(record.occurredAt)) / DAY_MS))
        : 999;
      const dimension = String(record.dimension || "").toLowerCase();
      const recencyWeight = ageDays <= 7 ? 2 : ageDays <= 30 ? 1 : 0;
      const coreWeight = coreDimensions.has(dimension) || [1, 2, 5, 27].includes(record.day) ? 2 : 0;
      const antiSignalWeight = record.isAntiSignal ? 1 : 0;
      return {
        ...record,
        marketRadarWeight: recencyWeight + coreWeight + antiSignalWeight,
      };
    })
    .sort((a, b) => {
      if (b.marketRadarWeight !== a.marketRadarWeight) return b.marketRadarWeight - a.marketRadarWeight;
      return Date.parse(b.occurredAt || "") - Date.parse(a.occurredAt || "");
    });
}

export async function collectWorkspaceEvidence({
  workspaceRoot,
  scanResult = {},
  onboardingHypothesis = null,
  fsImpl = fs,
} = {}) {
  const root = path.resolve(String(workspaceRoot || "."));
  const candidates = dedupeEvidenceCandidates([
    ...WORKSPACE_EVIDENCE_CANDIDATES,
    ...scanResultCandidates(scanResult),
  ]);
  const evidence = [];
  for (const candidate of candidates) {
    const relativePath = normalizeRelativeWorkspacePath(candidate.relativePath, root);
    if (!relativePath || isDeniedRelativePath(relativePath)) continue;
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(root + path.sep) && absolutePath !== root) continue;
    try {
      const stat = await fsImpl.stat(absolutePath);
      if (!stat.isFile()) continue;
      const raw = await fsImpl.readFile(absolutePath, "utf8");
      const excerpt = redactPrivateQueryText(raw).slice(0, MAX_EVIDENCE_CHARS_PER_DOC);
      if (!excerpt.trim()) continue;
      evidence.push({
        id: `${candidate.role}:${relativePath}`,
        sourceType: "workspace",
        role: candidate.role,
        path: relativePath,
        title: candidate.title || path.basename(relativePath),
        excerpt,
        charsRead: raw.length,
        truncated: raw.length > MAX_EVIDENCE_CHARS_PER_DOC,
      });
    } catch {
      // Missing docs are expected for early projects.
    }
  }
  return {
    workspaceRoot: root,
    onboardingHypothesis: normalizeOnboardingHypothesis(onboardingHypothesis),
    evidence,
  };
}

export async function loadNewsMarketRadarSnapshot({
  workspaceRoot,
  now = new Date(),
  fsImpl = fs,
  exaApiKey = "",
  exaConfigured = false,
  exaResearchSource = "",
} = {}) {
  const cachePath = resolveNewsMarketRadarCachePath(workspaceRoot);
  const raw = await readJsonFile(cachePath, fsImpl);
  const configured = exaConfigured || Boolean(String(exaApiKey || "").trim());
  if (raw?.snapshot) {
    const rawPromptProfile = cleanString(
      raw.snapshot?.promptProfile || raw.snapshot?.prompt_profile || "",
      120,
    );
    const snapshot = normalizeNewsMarketRadarSnapshot(raw.snapshot, {
      now,
      fallbackStatus: statusForSnapshot(raw.snapshot.status, now),
    });
    const exaNormalized = normalizeLegacyExaApiKeyMissingSnapshot(snapshot, {
      configured,
      exaResearchSource,
    });
    return normalizeLegacyPromptProfileSnapshot(exaNormalized, {
      configured,
      rawPromptProfile,
    });
  }
  return makeEmptyNewsMarketRadarSnapshot({
    now,
    status: configured ? "idle" : "failed",
    error: configured ? null : "Exa MCP is not configured.",
    reason: configured ? "not_loaded" : "exa_mcp_missing",
    researchSource: configured ? exaResearchSource : null,
  });
}

function normalizeLegacyExaApiKeyMissingSnapshot(
  snapshot,
  {
    configured = false,
    exaResearchSource = "",
  } = {},
) {
  if (snapshot?.status?.reason !== "exa_api_key_missing") return snapshot;
  if (configured) {
    return {
      ...snapshot,
      status: {
        state: "idle",
        lastSuccessAt: snapshot.status?.lastSuccessAt || null,
        stale: Boolean(snapshot.generatedAt),
        error: null,
        reason: "not_loaded",
        researchSource: cleanString(
          exaResearchSource || snapshot.status?.researchSource || "",
          160,
        ) || null,
      },
    };
  }
  return {
    ...snapshot,
    status: {
      ...snapshot.status,
      state: "failed",
      error: "Exa MCP is not configured.",
      reason: "exa_mcp_missing",
      researchSource: null,
    },
  };
}

function normalizeLegacyPromptProfileSnapshot(
  snapshot,
  {
    configured = false,
    rawPromptProfile = "",
  } = {},
) {
  if (!configured || rawPromptProfile === NEWS_MARKET_RADAR_PROMPT_PROFILE) return snapshot;
  const hasCards = (snapshot?.lanes || []).some((lane) => Array.isArray(lane.cards) && lane.cards.length > 0);
  if (!hasCards || snapshot?.status?.state === "failed") return snapshot;
  return {
    ...snapshot,
    status: {
      ...snapshot.status,
      state: "stale",
      stale: true,
      error: null,
      reason: "prompt_profile_changed",
    },
  };
}

export async function persistNewsMarketRadarSnapshot({
  workspaceRoot,
  snapshot,
  rawProviderResult = null,
  now = new Date(),
  adaptiveProfile = null,
} = {}) {
  const cachePath = resolveNewsMarketRadarCachePath(workspaceRoot);
  const runsDir = resolveNewsMarketRadarRunsDir(workspaceRoot);
  const normalized = normalizeNewsMarketRadarSnapshot(snapshot, { now, adaptiveProfile });
  await atomicWriteJson(cachePath, {
    schemaVersion: NEWS_MARKET_RADAR_CACHE_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    snapshot: normalized,
  });
  await fs.mkdir(runsDir, { recursive: true });
  const runPath = path.join(runsDir, `${safeTimestamp(now)}.json`);
  await atomicWriteJson(runPath, {
    schemaVersion: NEWS_MARKET_RADAR_CACHE_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    snapshot: normalized,
    rawProviderResult,
  });
  await pruneNewsMarketRadarRuns({ workspaceRoot, now });
  return normalized;
}

export async function pruneNewsMarketRadarRuns({
  workspaceRoot,
  now = new Date(),
  fsImpl = fs,
} = {}) {
  const runsDir = resolveNewsMarketRadarRunsDir(workspaceRoot);
  let entries = [];
  try {
    entries = await fsImpl.readdir(runsDir, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoff = now.getTime() - NEWS_MARKET_RADAR_RETENTION_DAYS * DAY_MS;
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".json")) return;
    const filePath = path.join(runsDir, entry.name);
    try {
      const stat = await fsImpl.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        await fsImpl.rm(filePath, { force: true });
      }
    } catch {
      // Ignore racing deletes.
    }
  }));
}

export async function refreshNewsMarketRadar({
  workspaceRoot,
  exaApiKey = "",
  exaMcpConfig = null,
  exaResearchRoute = null,
  exaResearchRoutes = [],
  reason = "manual",
  force = false,
  providerResearcher,
  providerSynthesizer = null,
  laneConcurrency = NEWS_MARKET_RADAR_LANE_CONCURRENCY,
  scanResult = {},
  onboardingHypothesis = null,
  now = new Date(),
  fsImpl = fs,
  onProgress = null,
} = {}) {
  const key = String(exaApiKey || "").trim();
  const routes = normalizeExaResearchRoutes({
    exaApiKey: key,
    exaMcpConfig,
    exaResearchRoute,
    exaResearchRoutes,
  });
  const primaryRoute = routes[0] || null;
  notifyNewsMarketRadarProgress(onProgress, {
    stage: "checking_exa_route",
    researchSource: primaryRoute?.label || null,
  });
  const previous = await loadNewsMarketRadarSnapshot({
    workspaceRoot,
    now,
    fsImpl,
    exaApiKey: key,
    exaConfigured: routes.length > 0,
    exaResearchSource: primaryRoute?.label || null,
  });
  if (routes.length === 0) {
    const noExaRoute = {
      ...previous,
      status: {
        state: "failed",
        lastSuccessAt: previous.status?.lastSuccessAt || null,
        stale: Boolean(previous.generatedAt),
        error: "Exa MCP is not configured.",
        reason: "exa_mcp_missing",
        researchSource: null,
      },
    };
    return persistNewsMarketRadarSnapshot({ workspaceRoot, snapshot: noExaRoute, now });
  }
  notifyNewsMarketRadarProgress(onProgress, {
    stage: "loading_workspace_evidence",
    researchSource: primaryRoute?.label || null,
  });
  const [answerLog, workspaceEvidence] = await Promise.all([
    loadCurriculumAnswerLog({ workspaceRoot, now, fsImpl }),
    collectWorkspaceEvidence({ workspaceRoot, scanResult, onboardingHypothesis, fsImpl }),
  ]);
  notifyNewsMarketRadarProgress(onProgress, {
    stage: "building_research_prompt",
    researchSource: primaryRoute?.label || null,
  });
  const rankedAnswers = rankAnswersForMarketRadar(answerLog.records, { now }).slice(0, 20);
  const context = buildMarketRadarResearchContext({
    workspaceRoot,
    workspaceEvidence,
    answers: rankedAnswers,
    now,
  });
  const contextFingerprint = fingerprintMarketRadarResearchContext(context);
  if (!force && previous.status?.state === "ready" && previous.generatedAt) {
    const ageMs = now.getTime() - Date.parse(previous.generatedAt);
    if (
      previous.contextFingerprint === contextFingerprint
      && Number.isFinite(ageMs)
      && ageMs < NEWS_MARKET_RADAR_REFRESH_INTERVAL_MS
    ) {
      return previous;
    }
  }
  if (typeof providerResearcher !== "function") {
    throw new Error("news market radar requires a providerResearcher.");
  }
  const selfReferenceProfile = context.selfReferenceProfile;
  notifyNewsMarketRadarProgress(onProgress, {
    stage: "running_provider_research",
    progressText: `${NEWS_LANE_IDS.length}개 가설을 병렬 리서치하는 중`,
    researchSource: primaryRoute?.label || null,
  });
  let completedLaneCount = 0;
  const laneResults = await runWithConcurrency(
    NEWS_LANE_IDS,
    laneConcurrency,
    async (laneId) => {
      const laneTitle = NEWS_LANE_TITLES[laneId];
      const laneContext = buildMarketRadarLaneResearchContext(context, laneId);
      try {
        const rawProviderResult = await providerResearcher({
          context: laneContext,
          prompt: buildMarketRadarLaneProviderPrompt(laneContext),
          exaMcpConfig: primaryRoute.mcpConfig,
          exaResearchRoute: summarizeExaResearchRoute(primaryRoute),
          exaResearchRoutes: routes,
          exaApiKeyConfigured: Boolean(key),
          reason,
          laneId,
          laneTitle,
          mode: "lane_research",
        });
        const lane = normalizeLaneResearchResult(rawProviderResult, laneId, {
          now,
          rankedAnswers,
          selfReferenceProfile,
          adaptiveProfile: laneContext.adaptiveProfile,
        });
        completedLaneCount += 1;
        notifyNewsMarketRadarProgress(onProgress, {
          stage: "running_provider_research",
          progressText: `${NEWS_LANE_IDS.length}개 중 ${completedLaneCount}개 완료`,
          researchSource: primaryRoute?.label || null,
        });
        return {
          ok: true,
          laneId,
          laneTitle,
          lane,
          rawProviderResult,
          researchSource: rawProviderResultResearchSource(rawProviderResult) || primaryRoute.label || null,
        };
      } catch (error) {
        completedLaneCount += 1;
        notifyNewsMarketRadarProgress(onProgress, {
          stage: "running_provider_research",
          progressText: `${NEWS_LANE_IDS.length}개 중 ${completedLaneCount}개 완료`,
          researchSource: primaryRoute?.label || null,
        });
        return {
          ok: false,
          laneId,
          laneTitle,
          error: formatMarketRadarError(error),
        };
      }
    },
  );
  const successfulLaneResults = laneResults.filter((result) => result.ok);
  const partialFailures = normalizePartialFailures(
    laneResults.filter((result) => !result.ok),
  );
  const researchSource = cleanString(
    successfulLaneResults.find((result) => result.researchSource)?.researchSource
      || primaryRoute.label
      || "",
    160,
  ) || null;

  if (successfulLaneResults.length === 0) {
    const noLaneSucceeded = {
      ...(hasSnapshotCards(previous) ? previous : makeEmptyNewsMarketRadarSnapshot({ now })),
      status: {
        state: "failed",
        lastSuccessAt: previous.status?.lastSuccessAt || null,
        stale: hasSnapshotCards(previous),
        error: `완료된 가설 리서치가 없습니다. ${partialFailures.map((failure) => failure.error).filter(Boolean).join(" | ")}`,
        reason,
        researchSource,
        partialFailures,
      },
    };
    return persistNewsMarketRadarSnapshot({
      workspaceRoot,
      snapshot: noLaneSucceeded,
      rawProviderResult: { laneResults },
      now,
    });
  }

  notifyNewsMarketRadarProgress(onProgress, {
    stage: "normalizing_cards",
    progressText: "중복 근거를 합쳐 한국어 카드로 정리하는 중",
    researchSource,
  });

  const deterministicSnapshot = buildDeterministicMarketRadarSnapshot({
    workspaceEvidence,
    rankedAnswers,
    successfulLaneResults,
    partialFailures,
    now,
    reason,
    researchSource,
    selfReferenceProfile,
    adaptiveProfile: context.adaptiveProfile,
    contextFingerprint,
  });

  let finalSnapshot = deterministicSnapshot;
  let rawSynthesisResult = null;
  let synthesisError = null;
  if (typeof providerSynthesizer === "function") {
    try {
      rawSynthesisResult = await providerSynthesizer({
        context,
        candidateSnapshot: deterministicSnapshot,
        partialFailures,
        prompt: buildMarketRadarSynthesisPrompt({
          context,
          candidateSnapshot: deterministicSnapshot,
          partialFailures,
        }),
        reason,
        researchSource,
        provider: primaryRoute.provider || "",
        mode: "final_synthesis",
      });
      const providerSnapshot = extractProviderSnapshot(rawSynthesisResult);
      finalSnapshot = limitSnapshotCardsPerLane(normalizeNewsMarketRadarSnapshot(providerSnapshot, {
        now,
        workspaceEvidence,
        rankedAnswers,
        selfReferenceProfile,
        adaptiveProfile: context.adaptiveProfile,
        fallbackStatus: {
          state: "ready",
          lastSuccessAt: now.toISOString(),
          stale: false,
          error: null,
          reason,
          researchSource: rawProviderResultResearchSource(rawSynthesisResult) || researchSource,
          partialFailures,
        },
      }), {
        now,
        rankedAnswers,
        selfReferenceProfile,
        adaptiveProfile: context.adaptiveProfile,
      });
    } catch (error) {
      synthesisError = formatMarketRadarError(error);
      finalSnapshot = deterministicSnapshot;
    }
  }

  notifyNewsMarketRadarProgress(onProgress, {
    stage: "saving_results",
    researchSource,
  });
  return persistNewsMarketRadarSnapshot({
    workspaceRoot,
    snapshot: {
      ...finalSnapshot,
      contextFingerprint,
    },
    rawProviderResult: {
      mode: "parallel_lane_research",
      laneResults,
      synthesisResult: rawSynthesisResult,
      synthesisError,
    },
    now,
    adaptiveProfile: context.adaptiveProfile,
  });
}

async function runWithConcurrency(items, limit, worker) {
  const concurrency = Math.max(1, Math.min(clampInt(limit, 1, 20, NEWS_MARKET_RADAR_LANE_CONCURRENCY), items.length));
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

function normalizeLaneResearchResult(rawProviderResult, laneId, {
  now = new Date(),
  rankedAnswers = [],
  selfReferenceProfile = null,
  adaptiveProfile = null,
} = {}) {
  const providerSnapshot = extractProviderSnapshot(rawProviderResult);
  const candidateLane = selectProviderLane(providerSnapshot, laneId);
  const normalized = normalizeLane({
    ...candidateLane,
    id: laneId,
    title: candidateLane.title || NEWS_LANE_TITLES[laneId],
    hypothesis: candidateLane.hypothesis || NEWS_LANE_HYPOTHESES[laneId],
  }, {
    now,
    rankedAnswers,
    selfReferenceProfile,
    adaptiveProfile,
  });
  return dedupeAndLimitLaneCards(normalized, {
    now,
    rankedAnswers,
    selfReferenceProfile,
    adaptiveProfile,
  });
}

function selectProviderLane(providerSnapshot = {}, laneId) {
  if (Array.isArray(providerSnapshot.lanes)) {
    return providerSnapshot.lanes.find((lane) => lane?.id === laneId)
      || providerSnapshot.lanes[0]
      || makeEmptyLane(laneId);
  }
  if (providerSnapshot.lane && typeof providerSnapshot.lane === "object") {
    return providerSnapshot.lane;
  }
  if (Array.isArray(providerSnapshot.cards)) {
    return {
      ...makeEmptyLane(laneId),
      cards: providerSnapshot.cards,
    };
  }
  return makeEmptyLane(laneId);
}

function buildDeterministicMarketRadarSnapshot({
  workspaceEvidence,
  rankedAnswers,
  successfulLaneResults,
  partialFailures,
  now,
  reason,
  researchSource,
  selfReferenceProfile = null,
  adaptiveProfile = null,
  contextFingerprint = null,
}) {
  const lanesById = new Map();
  for (const result of successfulLaneResults) {
    lanesById.set(result.laneId, dedupeAndLimitLaneCards(result.lane, {
      now,
      rankedAnswers,
      selfReferenceProfile,
      adaptiveProfile,
    }));
  }
  return limitSnapshotCardsPerLane(normalizeNewsMarketRadarSnapshot({
    schemaVersion: NEWS_MARKET_RADAR_SCHEMA_VERSION,
    contentLocale: NEWS_MARKET_RADAR_CONTENT_LOCALE,
    promptProfile: NEWS_MARKET_RADAR_PROMPT_PROFILE,
    contextFingerprint,
    generatedAt: now.toISOString(),
    nextRefreshAfter: new Date(now.getTime() + NEWS_MARKET_RADAR_REFRESH_INTERVAL_MS).toISOString(),
    status: {
      state: "ready",
      lastSuccessAt: now.toISOString(),
      stale: false,
      error: null,
      reason,
      researchSource,
      partialFailures,
    },
    lanes: NEWS_LANE_IDS.map((laneId) => lanesById.get(laneId) || makeEmptyLane(laneId)),
  }, {
    now,
    workspaceEvidence,
    rankedAnswers,
    selfReferenceProfile,
    adaptiveProfile,
  }), {
    now,
    rankedAnswers,
    selfReferenceProfile,
    adaptiveProfile,
  });
}

export function buildMarketRadarResearchContext({
  workspaceRoot,
  workspaceEvidence = {},
  answers = [],
  now = new Date(),
} = {}) {
  const workspaceBasename = path.basename(path.resolve(String(workspaceRoot || ".")));
  const hypothesis = normalizeOnboardingHypothesis(workspaceEvidence.onboardingHypothesis);
  const productName = cleanString(
    hypothesis.productName
      || inferProductNameFromEvidence(workspaceEvidence.evidence)
      || workspaceBasename,
    160,
  );
  const selfReferenceProfile = buildMarketRadarSelfReferenceProfile({
    workspaceRoot,
    workspaceEvidence,
    productName,
  });
  const targetUser = cleanString(
    hypothesis.targetUser || firstMatchingEvidenceLine(workspaceEvidence.evidence, /(ICP|target|사용자|persona)/i),
    500,
  );
  const problem = cleanString(
    hypothesis.problem || firstMatchingEvidenceLine(workspaceEvidence.evidence, /(pain|problem|통증|문제|cost|비용)/i),
    500,
  );
  const projectContext = {
    ...hypothesis,
    productName,
    targetUser,
    problem,
  };
  const answerSummaries = answers.map((answer) => ({
    id: answer.id,
    day: answer.day,
    dimension: answer.dimension,
    question: answer.questionTitle || answer.questionPrompt,
    answer: [answer.answerTitle, answer.freeformAnswer].filter(Boolean).join(" / "),
    isAntiSignal: answer.isAntiSignal,
    weight: answer.marketRadarWeight,
    occurredAt: answer.occurredAt,
  }));
  const adaptiveProfile = buildAdaptiveResearchProfile({
    workspaceRoot,
    workspaceEvidence,
    onboardingHypothesis: projectContext,
    answers,
    selfReferenceProfile,
    maxQuerySeeds: 18,
  });
  const querySeeds = uniqueStrings(adaptiveProfile.querySeeds
    .map(redactPrivateQueryText)
    .map(sanitizeWebSearchQuery)
    .filter(Boolean)
    .filter((seed) => !isSelfReferenceQuerySeed(seed, selfReferenceProfile)), 16);
  const searchExclusions = buildMarketRadarSearchExclusions({
    selfReferenceProfile,
    querySeeds,
  });
  const trustedSourceHints = buildMarketRadarTrustedSourceHints({
    querySeeds,
    selfReferenceProfile,
    adaptiveProfile,
  });
  return truncateForPrompt({
    generatedAt: now.toISOString(),
    workspace: {
      basename: workspaceBasename,
    },
    userLocale: NEWS_MARKET_RADAR_CONTENT_LOCALE,
    outputLanguage: "ko",
    productName,
    selfReferenceProfile,
    targetUser,
    problem,
    adaptiveProfile,
    marketLocale: adaptiveProfile.localeProfile.marketLocale,
    priority: "paid alternatives, pricing, reviews, buying behavior, public product/store pages",
    trustedSourcePolicy: marketRadarTrustedSourcePolicy(),
    trustedSourceHints,
    evidence: (workspaceEvidence.evidence || []).map((item) => ({
      id: item.id,
      role: item.role,
      path: item.path,
      title: item.title,
      excerpt: item.excerpt,
    })),
    answers: answerSummaries,
    querySeeds,
    searchExclusions,
    lanes: NEWS_LANE_IDS.map((id) => ({
      id,
      title: NEWS_LANE_TITLES[id],
      hypothesis: NEWS_LANE_HYPOTHESES[id],
    })),
  });
}

function fingerprintMarketRadarResearchContext(context = {}) {
  return createHash("sha256").update(JSON.stringify({
    promptProfile: NEWS_MARKET_RADAR_PROMPT_PROFILE,
    adaptiveProfileFingerprint: context.adaptiveProfile?.fingerprint || null,
    selfReferenceProfile: context.selfReferenceProfile,
    querySeeds: context.querySeeds || [],
    searchExclusions: context.searchExclusions || {},
    answers: (context.answers || []).map((answer) => ({
      id: answer.id,
      day: answer.day,
      dimension: answer.dimension,
      answer: answer.answer,
      isAntiSignal: answer.isAntiSignal,
    })),
    evidence: (context.evidence || []).map((item) => ({
      id: item.id,
      path: item.path,
      excerptHash: createHash("sha256").update(item.excerpt || "").digest("hex").slice(0, 16),
    })),
  })).digest("hex");
}

function buildMarketRadarTrustedSourceHints({
  querySeeds = [],
  selfReferenceProfile = null,
  adaptiveProfile = null,
} = {}) {
  return Object.fromEntries(NEWS_LANE_IDS.map((laneId) => [
    laneId,
    buildMarketRadarLaneTrustedSourceHints({
      laneId,
      querySeeds,
      selfReferenceProfile,
      adaptiveProfile,
    }),
  ]));
}

function buildMarketRadarLaneTrustedSourceHints({
  laneId = "",
  querySeeds = [],
  selfReferenceProfile = null,
  adaptiveProfile = null,
} = {}) {
  const profile = normalizeSelfReferenceProfile(selfReferenceProfile);
  const localeProfile = adaptiveProfile?.localeProfile || null;
  const queries = buildTrustedSourceQueriesForLane({ laneId, querySeeds, localeProfile })
    .map(redactPrivateQueryText)
    .map(sanitizeWebSearchQuery)
    .filter(Boolean)
    .filter((query) => !isSelfReferenceQuerySeed(query, profile))
    .slice(0, 12);
  return {
    mode: "priority_seed_not_whitelist",
    sources: trustedSourcesForMarketRadarPrompt(laneId, { localeProfile }),
    queries,
  };
}

function marketRadarTrustedSourcePolicy() {
  return {
    mode: "priority_seed_not_whitelist",
    localeRules: [
      "Source priority must follow Context.adaptiveProfile.localeProfile and the user's own project/Day/answer language signals.",
      "Do not add geography, persona, tool-stack, or platform terms that are absent from Context.adaptiveProfile.querySeeds.",
      "Use global sources as supplementary evidence when matching-language or matching-market evidence is sparse, or when official pricing/product pages are stronger evidence.",
    ],
    confidenceRules: [
      "Strong confidence requires 2+ independent external domains, or a primary trusted source plus independent current market evidence.",
      "Community-only evidence cannot be strong.",
      "Evergreen essays and handbooks can support interpretation but need current evidence for live market trend claims.",
      "Subscription or paywalled sources may be cited only from publicly accessible metadata, summaries, or excerpts.",
    ],
  };
}

export function buildMarketRadarProviderPrompt(context) {
  return [
    "You are Market Radar. Use Exa MCP web_search_advanced_exa and web_fetch_exa for public market research.",
    "Return ONLY strict JSON. No markdown fences.",
    "",
    "Goal:",
    "- Find public evidence about paid alternatives, pricing, reviews, buying/conversion behavior, product/store/pricing pages, and community discussions.",
    "- Adapt the evidence to the user's workspace docs and Day 1-30 answers.",
    "- Do not propose automatic edits. Suggest hypothesis updates only.",
    "",
    "Self-source exclusion:",
    "- Context.selfReferenceProfile describes the current user's own product/app. Use it only as an exclusion list.",
    "- Context.searchExclusions contains query-time filters derived from the current user's project. Pass excludeDomains, excludeText, and additionalQueries to web_search_advanced_exa when those arrays are non-empty.",
    "- Do not add more than one excludeText item. Exa MCP only reliably supports a single excludeText string.",
    "- Do not search for the current product name, owned domains, GitHub repositories, or product listings.",
    "- Discard pages that describe, list, price, announce, or compare the current product itself. The product name is interpretation context, not market evidence.",
    "- If a source mentions the current product, omit that source. If a card has no remaining external web source, omit the card.",
    "- If web_search_advanced_exa is unavailable on the configured route, use web_search_exa only with sanitized querySeeds that do not contain self-reference terms.",
    "",
    "Adaptive source policy:",
    "- Build searches from Context.adaptiveProfile.querySeeds, Context.lanes, and Context.answers. Do not add fixed persona, geography, tool-stack, or platform assumptions.",
    "- Context.adaptiveProfile.localeProfile describes inferred language/market priority. Prefer matching-language and matching-market sources first, then use global sources when evidence quality is stronger or local evidence is sparse.",
    "- When sources are outside the inferred locale, explain the market implication for the user's context rather than translating them as-is.",
    "",
    "Trusted source policy:",
    "- Context.trustedSourceHints lists preferred source seeds and site queries by lane. Use them as priority starting points, not a mandatory citation list or hard whitelist.",
    "- Search at least 2 relevant trusted-source queries for a lane when they are not self-referential, then search the open web for current pricing, reviews, product pages, and community evidence.",
    "- Strong confidence requires 2+ independent external domains, or a primary trusted source plus independent current market evidence.",
    "- Community-only sources such as launch/community forums can support a card but cannot make confidence strong by themselves.",
    "- Evergreen founder essays and company handbooks can support interpretation, but claims about live market trends need current evidence.",
    "- Subscription or paywalled sources must be cited only from publicly accessible titles, summaries, metadata, or excerpts. Do not invent inaccessible details.",
    "",
    "Output language:",
    "- All user-facing prose in the JSON must be Korean (한국어).",
    "- Write lane title/hypothesis, card title, summary, whyItMatters, suggestedHypothesisUpdate, and sourceRefs.excerpt in Korean.",
    "- Keep JSON keys, ids, enum values, URLs, domains, currency symbols, product names, plan names, and official source titles unchanged.",
    "- If a source page is English, summarize or paraphrase the supporting excerpt in Korean instead of copying English prose.",
    "- Do not emit English prose for card bodies even when every source is English.",
    "",
    "Evidence policy:",
    "- Strong confidence requires at least 2 independent source domains pointing in the same direction, subject to the trusted source policy above.",
    "- If evidence conflicts, keep both sides and mark impact as mixed.",
    "- Every card must include sourceRefs with URLs for web evidence or workspace paths for local evidence.",
    "- Do not include raw secrets, emails, tokens, or private customer names.",
    "",
    "JSON schema:",
    JSON.stringify(makeProviderSchemaExample(), null, 2),
    "",
    "Context:",
    JSON.stringify(context, null, 2),
  ].join("\n").slice(0, MAX_PROVIDER_PROMPT_CHARS);
}

export function buildMarketRadarLaneResearchContext(context = {}, laneId = "") {
  const lane = (context.lanes || []).find((item) => item.id === laneId) || {
    id: laneId,
    title: NEWS_LANE_TITLES[laneId],
    hypothesis: NEWS_LANE_HYPOTHESES[laneId],
  };
  const selfReferenceProfile = normalizeSelfReferenceProfile(context.selfReferenceProfile);
  const answers = answersForLane(context.answers || [], laneId);
  const baseQuerySeeds = [
    ...(context.querySeeds || []),
    laneResearchFocus(laneId),
    ...answers.slice(0, 4).map((answer) => answer.answer),
  ]
    .map(redactPrivateQueryText)
    .map(sanitizeWebSearchQuery)
    .filter(Boolean)
    .filter((seed) => !isSelfReferenceQuerySeed(seed, selfReferenceProfile))
    .slice(0, 14);
  const trustedSourceHints = buildMarketRadarLaneTrustedSourceHints({
    laneId,
    querySeeds: baseQuerySeeds,
    selfReferenceProfile,
    adaptiveProfile: context.adaptiveProfile,
  });
  const trustedSourceQueries = normalizeStringArray(trustedSourceHints.queries, 12, 256)
    .filter((seed) => !isSelfReferenceQuerySeed(seed, selfReferenceProfile));
  const querySeeds = uniqueStrings([
    ...trustedSourceQueries.slice(0, 6),
    ...baseQuerySeeds,
  ], 18);
  return truncateForPrompt({
    ...context,
    selfReferenceProfile,
    lane,
    lanes: [lane],
    answers,
    researchFocus: laneResearchFocus(laneId),
    querySeeds,
    trustedSourceHints,
    searchExclusions: buildMarketRadarSearchExclusions({
      selfReferenceProfile,
      querySeeds,
    }),
  });
}

export function buildMarketRadarLaneProviderPrompt(context) {
  return [
    "You are Market Radar. Use Exa MCP web_search_advanced_exa and web_fetch_exa for focused public market research.",
    "Return ONLY strict JSON. No markdown fences.",
    "",
    "Goal:",
    "- Research only the single lane in Context.lane.",
    "- Find public evidence about paid alternatives, pricing, reviews, buying/conversion behavior, product/store/pricing pages, and community discussions that helps validate or falsify this lane.",
    "- Return candidate cards for this lane only. Do not include other lanes.",
    "",
    "Self-source exclusion:",
    "- Context.selfReferenceProfile describes the current user's own product/app. Use it only as an exclusion list.",
    "- Context.searchExclusions contains query-time filters derived from the current user's project. Pass excludeDomains, excludeText, and additionalQueries to web_search_advanced_exa when those arrays are non-empty.",
    "- Do not add more than one excludeText item. Exa MCP only reliably supports a single excludeText string.",
    "- Do not search for the current product name, owned domains, GitHub repositories, or product listings.",
    "- Discard pages that describe, list, price, announce, or compare the current product itself.",
    "- If a source mentions the current product, omit that source. If a card has no remaining external web source, omit the card.",
    "- If web_search_advanced_exa is unavailable on the configured route, use web_search_exa only with sanitized querySeeds that do not contain self-reference terms.",
    "",
    "Adaptive source policy:",
    "- Build searches from Context.adaptiveProfile.querySeeds, Context.lane, and Context.answers. Do not add fixed persona, geography, tool-stack, or platform assumptions.",
    "- Context.adaptiveProfile.localeProfile describes inferred language/market priority. Prefer matching-language and matching-market sources first, then use global sources when evidence quality is stronger or local evidence is sparse.",
    "- When sources are outside the inferred locale, explain the market implication for the user's context rather than translating them as-is.",
    "",
    "Trusted source policy:",
    "- Context.trustedSourceHints lists preferred source seeds and site queries for this lane. Use them as priority starting points, not a mandatory citation list or hard whitelist.",
    "- Search at least 2 relevant trusted-source queries when they are not self-referential, then search the open web for current pricing, reviews, product pages, and community evidence.",
    "- Strong confidence requires 2+ independent external domains, or a primary trusted source plus independent current market evidence.",
    "- Community-only sources such as launch/community forums can support a card but cannot make confidence strong by themselves.",
    "- Evergreen founder essays and company handbooks can support interpretation, but claims about live market trends need current evidence.",
    "- Subscription or paywalled sources must be cited only from publicly accessible titles, summaries, metadata, or excerpts. Do not invent inaccessible details.",
    "",
    "Output language:",
    "- All user-facing prose in the JSON must be Korean (한국어).",
    "- Write card title, summary, whyItMatters, suggestedHypothesisUpdate, and sourceRefs.excerpt in Korean.",
    "- Keep JSON keys, ids, enum values, URLs, domains, currency symbols, product names, plan names, and official source titles unchanged.",
    "- If a source page is English, summarize or paraphrase the supporting excerpt in Korean instead of copying English prose.",
    "",
    "Evidence policy:",
    "- Strong confidence requires at least 2 independent source domains pointing in the same direction, subject to the trusted source policy above.",
    "- Every card must include sourceRefs with URLs for web evidence or workspace paths for local evidence.",
    "- Do not include raw secrets, emails, tokens, or private customer names.",
    "- Prefer 2-4 high-signal cards. Never return more than 6 cards.",
    "",
    "JSON schema:",
    JSON.stringify(makeLaneProviderSchemaExample(), null, 2),
    "",
    "Context:",
    JSON.stringify(context, null, 2),
  ].join("\n").slice(0, MAX_PROVIDER_PROMPT_CHARS);
}

export function buildMarketRadarSynthesisPrompt({
  context = {},
  candidateSnapshot = {},
  partialFailures = [],
} = {}) {
  return [
    "You are Market Radar's final synthesis pass.",
    "Return ONLY strict JSON. No markdown fences.",
    "",
    "Rules:",
    "- Do not browse, search, fetch, or call web tools. Use only Candidate snapshot and Context below.",
    "- Deduplicate overlapping cards by source URL, source domain, and repeated title meaning.",
    "- Produce the final News Market Radar snapshot in Korean.",
    "- Preserve adaptive locale ordering: when evidence quality is similar, prefer cards grounded in Context.adaptiveProfile.localeProfile and querySeeds.",
    `- Keep at most ${NEWS_MARKET_RADAR_MAX_CARDS_PER_LANE} cards per lane.`,
    "- Strong confidence requires at least 2 independent source domains pointing in the same direction.",
    "- Preserve product names, plan names, URLs, domains, currency symbols, and official source titles.",
    "- Keep partialFailures in status if present.",
    "- Remove sources matching Context.selfReferenceProfile. Remove cards with no remaining external web source.",
    "",
    "JSON schema:",
    JSON.stringify(makeProviderSchemaExample(), null, 2),
    "",
    "Context:",
    JSON.stringify({
      generatedAt: context.generatedAt,
      productName: context.productName,
      targetUser: context.targetUser,
      problem: context.problem,
      selfReferenceProfile: context.selfReferenceProfile,
      adaptiveProfile: context.adaptiveProfile,
      marketLocale: context.marketLocale,
      trustedSourcePolicy: context.trustedSourcePolicy,
      lanes: context.lanes,
      answers: (context.answers || []).slice(0, 12),
    }, null, 2),
    "",
    "Candidate snapshot:",
    JSON.stringify({
      ...candidateSnapshot,
      status: {
        ...(candidateSnapshot.status || {}),
        partialFailures,
      },
    }, null, 2),
  ].join("\n").slice(0, MAX_PROVIDER_PROMPT_CHARS);
}

export function buildMarketRadarSelfReferenceProfile({
  workspaceRoot,
  workspaceEvidence = {},
  productName = "",
} = {}) {
  const workspaceBasename = path.basename(path.resolve(String(workspaceRoot || ".")));
  const terms = new Set();
  addSelfReferenceTermVariants(terms, productName);
  addSelfReferenceTermVariants(terms, workspaceBasename);

  const ownedDomains = new Set();
  const githubRepoSlugs = new Set();
  const evidenceText = (workspaceEvidence.evidence || [])
    .map((item) => [item.title, item.path, item.excerpt].filter(Boolean).join(" "))
    .join("\n");

  for (const rawUrl of extractUrlsFromText(evidenceText)) {
    let parsed = null;
    try {
      parsed = new URL(rawUrl);
    } catch {
      continue;
    }
    const domain = normalizeDomain(parsed.hostname);
    if (domain === "github.com") {
      const slug = githubRepoSlugFromUrl(parsed);
      if (slug && selfReferenceTermsMatch(`${slug.owner} ${slug.repo}`, terms)) {
        githubRepoSlugs.add(`${slug.owner}/${slug.repo}`);
      }
      continue;
    }
    if (domain && selfReferenceTermsMatch(domain, terms)) {
      ownedDomains.add(domain);
    }
  }

  return normalizeSelfReferenceProfile({
    productName,
    workspaceBasename,
    terms: [...terms],
    ownedDomains: [...ownedDomains],
    githubRepoSlugs: [...githubRepoSlugs],
  });
}

function normalizeSelfReferenceProfile(value = {}) {
  const profile = objectOrEmpty(value);
  const terms = new Set();
  addSelfReferenceTermVariants(terms, profile.productName);
  addSelfReferenceTermVariants(terms, profile.workspaceBasename);
  for (const term of profile.terms || profile.productNames || profile.product_names || []) {
    addSelfReferenceTermVariants(terms, term);
  }
  const ownedDomains = normalizeDomainArray(profile.ownedDomains || profile.owned_domains);
  const githubRepoSlugs = normalizeGithubRepoSlugs(profile.githubRepoSlugs || profile.github_repo_slugs);
  return {
    productName: cleanString(profile.productName || profile.product_name || "", 160),
    workspaceBasename: cleanString(profile.workspaceBasename || profile.workspace_basename || "", 160),
    terms: [...terms],
    ownedDomains,
    githubRepoSlugs,
    listingDomains: normalizeDomainArray(profile.listingDomains || profile.listing_domains),
  };
}

function addSelfReferenceTermVariants(terms, value) {
  const raw = cleanString(value || "", 240);
  if (!raw) return;
  const normalized = normalizeDedupeText(raw);
  addSelfReferenceTerm(terms, normalized);
  const parts = normalized.split(/\s+/).filter(Boolean);
  for (const part of parts) {
    addSelfReferenceTerm(terms, part);
  }
  if (parts.length > 1 && SELF_REFERENCE_STOP_TERMS.has(parts[parts.length - 1])) {
    addSelfReferenceTerm(terms, parts.slice(0, -1).join(" "));
  }
}

function addSelfReferenceTerm(terms, value) {
  const normalized = normalizeDedupeText(value);
  const collapsed = normalized.replace(/\s+/g, "");
  if (!collapsed || collapsed.length < 4) return;
  if (SELF_REFERENCE_STOP_TERMS.has(normalized)) return;
  terms.add(normalized);
}

function isSelfReferenceQuerySeed(seed, selfReferenceProfile) {
  const profile = normalizeSelfReferenceProfile(selfReferenceProfile);
  return profile.terms.some((term) => normalizedTextIncludesTerm(seed, term));
}

function isSelfReferenceSource(source = {}, selfReferenceProfile = null) {
  const profile = normalizeSelfReferenceProfile(selfReferenceProfile);
  if (
    profile.terms.length === 0
    && profile.ownedDomains.length === 0
    && profile.githubRepoSlugs.length === 0
  ) {
    return false;
  }
  const domain = normalizeDomain(source.domain || domainFromUrl(source.url));
  if (domain && profile.ownedDomains.some((ownedDomain) => domainMatches(domain, ownedDomain))) {
    return true;
  }
  if (domain === "github.com" && githubSourceMatchesProfile(source, profile)) {
    return true;
  }

  const haystack = [
    source.title,
    source.url,
    source.domain,
    source.path,
    source.excerpt,
  ].filter(Boolean).join(" ");
  const mentionsSelfReferenceTerm = selfReferenceMentionTerms(profile)
    .some((term) => normalizedTextIncludesTerm(haystack, term));
  if (mentionsSelfReferenceTerm) return true;
  return false;
}

function buildMarketRadarSearchExclusions({
  selfReferenceProfile = null,
  querySeeds = [],
} = {}) {
  const profile = normalizeSelfReferenceProfile(selfReferenceProfile);
  const excludeText = chooseSelfReferenceExcludeText(profile);
  return {
    excludeDomains: profile.ownedDomains.slice(0, 30),
    excludeText: excludeText ? [excludeText] : [],
    additionalQueries: normalizeAdditionalSearchQueries(querySeeds, profile),
  };
}

function chooseSelfReferenceExcludeText(profile) {
  const candidates = [
    profile.productName,
    profile.workspaceBasename,
    ...selfReferenceMentionTerms(profile),
    ...profile.githubRepoSlugs,
  ]
    .map((term) => cleanString(term, 160))
    .filter(Boolean);
  const unique = [];
  for (const candidate of candidates) {
    if (!unique.some((previous) => normalizeDedupeText(previous) === normalizeDedupeText(candidate))) {
      unique.push(candidate);
    }
  }
  return unique.find((term) => isDistinctiveSelfReferenceTerm(term))
    || unique.find((term) => normalizeDedupeText(term).replace(/\s+/g, "").length >= 4)
    || "";
}

function normalizeAdditionalSearchQueries(querySeeds = [], selfReferenceProfile = null) {
  const profile = normalizeSelfReferenceProfile(selfReferenceProfile);
  const queries = [];
  for (const seed of querySeeds) {
    const query = sanitizeWebSearchQuery(redactPrivateQueryText(seed));
    if (!query || isSelfReferenceQuerySeed(query, profile)) continue;
    if (queries.some((previous) => normalizeDedupeText(previous) === normalizeDedupeText(query))) continue;
    queries.push(query);
    if (queries.length >= 6) break;
  }
  return queries;
}

function hasExternalWebSourceRef(sourceRefs = []) {
  return sourceRefs.some((source) => source.url && source.sourceType !== "workspace");
}

function extractUrlsFromText(text = "") {
  return [...String(text || "").matchAll(/https?:\/\/[^\s)\]>"']+/g)].map((match) => match[0]);
}

function selfReferenceTermsMatch(value = "", terms = new Set()) {
  return [...terms].some((term) => normalizedTextIncludesTerm(value, term));
}

function normalizedTextIncludesTerm(text = "", term = "") {
  const normalizedText = normalizeDedupeText(decodeURIComponentSafe(text));
  const normalizedTerm = normalizeDedupeText(term);
  if (!normalizedText || !normalizedTerm) return false;
  return new RegExp(`(^|\\s)${escapeRegExp(normalizedTerm)}(\\s|$)`, "u").test(normalizedText);
}

function isDistinctiveSelfReferenceTerm(term = "") {
  const collapsed = normalizeDedupeText(term).replace(/\s+/g, "");
  return /\d/.test(collapsed) || collapsed.length >= 8;
}

function selfReferenceMentionTerms(profile = {}) {
  const normalized = normalizeSelfReferenceProfile(profile);
  const terms = new Set();
  addSelfReferenceTerm(terms, normalized.productName);
  addSelfReferenceTerm(terms, normalized.workspaceBasename);
  for (const term of normalized.terms) {
    if (isDistinctiveSelfReferenceTerm(term)) addSelfReferenceTerm(terms, term);
  }
  for (const slug of normalized.githubRepoSlugs) {
    const repoName = slug.split("/")[1] || "";
    addSelfReferenceTerm(terms, repoName);
    addSelfReferenceTerm(terms, slug);
  }
  return [...terms];
}

function githubSourceMatchesProfile(source = {}, profile) {
  const slug = githubRepoSlugFromUrl(source.url || "");
  if (slug) {
    const normalizedSlug = `${slug.owner}/${slug.repo}`;
    if (profile.githubRepoSlugs.some((candidate) => githubRepoSlugMatches(normalizedSlug, candidate))) {
      return true;
    }
    if (profile.terms.some((term) => normalizedTextIncludesTerm(`${slug.owner} ${slug.repo}`, term))) {
      return true;
    }
  }
  const haystack = [source.title, source.excerpt, source.url].filter(Boolean).join(" ");
  return profile.githubRepoSlugs.some((candidate) => normalizedTextIncludesTerm(haystack, candidate))
    || profile.terms.filter(isDistinctiveSelfReferenceTerm).some((term) => normalizedTextIncludesTerm(haystack, term));
}

function githubRepoSlugFromUrl(rawUrl = "") {
  try {
    const parsed = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl || ""));
    if (normalizeDomain(parsed.hostname) !== "github.com") return null;
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return {
      owner: owner.toLowerCase(),
      repo: repo.toLowerCase().replace(/\.git$/, ""),
    };
  } catch {
    return null;
  }
}

function githubRepoSlugMatches(a = "", b = "") {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

function normalizeGithubRepoSlugs(value) {
  if (!Array.isArray(value)) return [];
  const slugs = value
    .map((item) => cleanString(item, 240).toLowerCase().replace(/^https?:\/\/github\.com\//, ""))
    .map((item) => item.split(/[?#]/)[0].replace(/\/+$/, "").replace(/\.git$/, ""))
    .filter((item) => /^[^/\s]+\/[^/\s]+$/.test(item));
  return [...new Set(slugs)].slice(0, 20);
}

function normalizeDomainArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeDomain).filter(Boolean))].slice(0, 30);
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

function decodeURIComponentSafe(value = "") {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeNewsMarketRadarSnapshot(
  value = {},
  {
    now = new Date(),
    workspaceEvidence = null,
    rankedAnswers = [],
    fallbackStatus = null,
    selfReferenceProfile = null,
    adaptiveProfile = null,
  } = {},
) {
  const normalizedSelfReferenceProfile = normalizeSelfReferenceProfile(
    selfReferenceProfile
      || value.selfReferenceProfile
      || value.self_reference_profile,
  );
  const status = statusForSnapshot({
    ...(fallbackStatus || {}),
    ...(value.status || {}),
  }, now);
  const lanesById = new Map();
  for (const lane of Array.isArray(value.lanes) ? value.lanes : []) {
    const normalizedLane = normalizeLane(lane, {
      now,
      rankedAnswers,
      selfReferenceProfile: normalizedSelfReferenceProfile,
      adaptiveProfile,
    });
    lanesById.set(normalizedLane.id, normalizedLane);
  }
  for (const laneId of NEWS_LANE_IDS) {
    if (!lanesById.has(laneId)) {
      lanesById.set(laneId, makeEmptyLane(laneId));
    }
  }
  const lanes = NEWS_LANE_IDS.map((laneId) => lanesById.get(laneId));
  const generatedAt = normalizeIsoDate(value.generatedAt, now);
  return {
    schemaVersion: NEWS_MARKET_RADAR_SCHEMA_VERSION,
    contentLocale: NEWS_MARKET_RADAR_CONTENT_LOCALE,
    promptProfile: NEWS_MARKET_RADAR_PROMPT_PROFILE,
    contextFingerprint: cleanString(value.contextFingerprint || value.context_fingerprint || "", 128) || null,
    generatedAt,
    nextRefreshAfter: normalizeIsoDate(
      value.nextRefreshAfter,
      new Date(Date.parse(generatedAt) + NEWS_MARKET_RADAR_REFRESH_INTERVAL_MS),
    ),
    status,
    workspaceEvidenceRefs: normalizeWorkspaceRefs(value.workspaceEvidenceRefs, workspaceEvidence),
    lanes,
  };
}

export function makeEmptyNewsMarketRadarSnapshot({
  now = new Date(),
  status = "idle",
  error = null,
  reason = null,
  researchSource = null,
} = {}) {
  return normalizeNewsMarketRadarSnapshot({
    schemaVersion: NEWS_MARKET_RADAR_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    nextRefreshAfter: new Date(now.getTime() + NEWS_MARKET_RADAR_REFRESH_INTERVAL_MS).toISOString(),
    status: {
      state: status,
      lastSuccessAt: status === "ready" ? now.toISOString() : null,
      stale: false,
      error,
      reason,
      researchSource,
    },
    lanes: NEWS_LANE_IDS.map(makeEmptyLane),
  }, { now });
}

export function extractProviderSnapshot(rawProviderResult) {
  if (!rawProviderResult) return {};
  if (typeof rawProviderResult === "object" && rawProviderResult.snapshot) return rawProviderResult.snapshot;
  if (typeof rawProviderResult === "object" && Array.isArray(rawProviderResult.lanes)) return rawProviderResult;
  if (typeof rawProviderResult === "object" && rawProviderResult.lane) return { lane: rawProviderResult.lane };
  if (typeof rawProviderResult === "object" && Array.isArray(rawProviderResult.cards)) return { cards: rawProviderResult.cards };
  const text = typeof rawProviderResult === "string"
    ? rawProviderResult
    : String(rawProviderResult.text || rawProviderResult.content || "");
  const jsonText = extractJsonObject(text);
  if (!jsonText) throw new Error("news market radar provider did not return JSON.");
  return JSON.parse(jsonText);
}

function normalizeLane(value = {}, {
  now = new Date(),
  rankedAnswers = [],
  selfReferenceProfile = null,
  adaptiveProfile = null,
} = {}) {
  const id = NEWS_LANE_IDS.includes(value.id) ? value.id : "problem";
  const cards = Array.isArray(value.cards)
    ? value.cards
        .map((card, index) => normalizeCard(card, {
          laneId: id,
          index,
          rankedAnswers,
          selfReferenceProfile,
        }))
        .filter(Boolean)
    : [];
  return dedupeAndLimitLaneCards({
    id,
    title: cleanString(value.title || NEWS_LANE_TITLES[id], 120),
    hypothesis: cleanString(value.hypothesis || NEWS_LANE_HYPOTHESES[id], 300),
    impact: normalizeImpact(value.impact || aggregateImpact(cards)),
    confidence: normalizeConfidence(value.confidence || aggregateConfidence(cards)),
    cards,
  }, {
    now,
    rankedAnswers,
    selfReferenceProfile,
    adaptiveProfile,
  });
}

function normalizeCard(value = {}, {
  laneId,
  index,
  rankedAnswers = [],
  selfReferenceProfile = null,
} = {}) {
  const sourceRefs = normalizeSourceRefs(value.sourceRefs ?? value.sources ?? [], {
    selfReferenceProfile,
  });
  if (!hasExternalWebSourceRef(sourceRefs)) return null;
  const domains = new Set(sourceRefs.filter((source) => source.url).map((source) => source.domain).filter(Boolean));
  const confidence = normalizeCardConfidence(value.confidence, domains.size, sourceRefs);
  const relatedAnswerIds = Array.isArray(value.relatedAnswerIds)
    ? value.relatedAnswerIds.map((id) => cleanString(id, 180)).filter(Boolean)
    : rankedAnswers.slice(0, 3).map((answer) => answer.id);
  return {
    id: cleanString(value.id || `${laneId}-card-${index + 1}`, 180),
    title: cleanString(value.title || "시장 신호", 220),
    summary: cleanString(value.summary || value.body || "", 1_200),
    impact: normalizeImpact(value.impact),
    confidence,
    whyItMatters: cleanString(value.whyItMatters || value.why_it_matters || "", 1_200),
    suggestedHypothesisUpdate: cleanString(
      value.suggestedHypothesisUpdate || value.suggested_hypothesis_update || "",
      1_500,
    ),
    suggestedDocTargets: normalizeStringArray(value.suggestedDocTargets || value.suggested_doc_targets, 6, 80),
    relatedDays: normalizeIntArray(value.relatedDays || value.related_days, 1, 30, 8),
    relatedAnswerIds,
    sourceRefs,
    evidenceStrength: confidence,
  };
}

function normalizeSourceRefs(value, { selfReferenceProfile = null } = {}) {
  if (!Array.isArray(value)) return [];
  const normalizedSelfReferenceProfile = normalizeSelfReferenceProfile(selfReferenceProfile);
  const normalized = value
    .map((source, index) => {
      const url = cleanString(source.url || "", 1_000);
      const domain = cleanString(source.domain || domainFromUrl(url), 160);
      const pathValue = cleanString(source.path || source.filePath || "", 500);
      const sourceType = cleanString(source.sourceType || source.type || (url ? "web" : "workspace"), 80);
      const publishedAt = cleanString(source.publishedAt || source.published_at || "", 80);
      const excerpt = cleanString(source.excerpt || source.quote || "", 700);
      return {
        id: cleanString(
          source.id || fallbackMarketRadarSourceRefId({
            sourceType,
            domain,
            pathValue,
            url,
            excerpt,
            index,
          }),
          220,
        ),
        sourceType,
        title: cleanString(source.title || domain || pathValue || "source", 220),
        url,
        domain,
        path: pathValue,
        publishedAt,
        excerpt,
      };
    })
    .filter((source) => source.url || source.path || source.excerpt)
    .filter((source) => !isSelfReferenceSource(source, normalizedSelfReferenceProfile));
  return dedupeSourceRefs(normalized).slice(0, 12);
}

function fallbackMarketRadarSourceRefId({
  sourceType = "source",
  domain = "",
  pathValue = "",
  url = "",
  excerpt = "",
  index = 0,
} = {}) {
  const sourceKey = canonicalMarketRadarSourceKey({ url, path: pathValue, excerpt });
  if (sourceKey) {
    return `${sourceType}-${domain || "source"}-${shortStableHash(sourceKey)}`;
  }
  return `${sourceType}-${domain || pathValue || index}`;
}

function shortStableHash(value = "") {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function normalizeWorkspaceRefs(value, workspaceEvidence) {
  if (Array.isArray(value)) {
    return normalizeSourceRefs(value);
  }
  return normalizeSourceRefs((workspaceEvidence?.evidence || []).slice(0, 8));
}

function normalizePartialFailures(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((failure) => {
      const laneId = NEWS_LANE_IDS.includes(failure?.laneId || failure?.lane_id)
        ? (failure.laneId || failure.lane_id)
        : "";
      const laneTitle = cleanString(failure?.laneTitle || failure?.lane_title || NEWS_LANE_TITLES[laneId] || "", 120);
      const error = cleanString(failure?.error || failure?.message || "", 500);
      if (!laneId || !error) return null;
      return {
        laneId,
        laneTitle: laneTitle || NEWS_LANE_TITLES[laneId],
        error,
      };
    })
    .filter(Boolean)
    .slice(0, NEWS_LANE_IDS.length);
}

function hasSnapshotCards(snapshot = {}) {
  return (snapshot.lanes || []).some((lane) => Array.isArray(lane.cards) && lane.cards.length > 0);
}

function rawProviderResultResearchSource(rawProviderResult = {}) {
  return cleanString(
    rawProviderResult?.researchSource
      || rawProviderResult?.research_source
      || rawProviderResult?.exaResearchSource
      || "",
    160,
  ) || null;
}

function formatMarketRadarError(error) {
  return cleanString(error?.message || error || "알 수 없는 리서치 오류", 500);
}

function answersForLane(answers = [], laneId = "") {
  const keywords = laneAnswerKeywords(laneId);
  const matching = answers.filter((answer) => {
    const haystack = [
      answer.dimension,
      answer.question,
      answer.answer,
    ].join(" ").toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });
  return (matching.length ? matching : answers).slice(0, 10);
}

function laneAnswerKeywords(laneId = "") {
  switch (laneId) {
  case "icp":
    return ["icp", "persona", "target", "user", "customer", "segment", "사용자", "고객"];
  case "problem":
    return ["pain", "problem", "cost", "friction", "문제", "고통", "비용", "마찰"];
  case "alternatives_pricing":
    return ["pricing", "price", "alternative", "competitor", "spend", "대안", "가격", "결제", "경쟁"];
  case "channel":
    return ["channel", "community", "launch", "distribution", "채널", "유입", "커뮤니티", "런칭"];
  case "platform":
    return ["platform", "store", "mac", "terminal", "editor", "플랫폼", "스토어", "터미널", "에디터"];
  default:
    return [];
  }
}

function laneResearchFocus(laneId = "") {
  switch (laneId) {
  case "icp":
    return "Find public signals about who pays most urgently, buyer personas, customer segments, and context fit.";
  case "problem":
    return "Find public signals about pain intensity, workflow friction, wasted time, failed validation, and switching triggers.";
  case "alternatives_pricing":
    return "Find public pricing, paid alternatives, reviews, lifetime deals, willingness-to-pay, and budget anchors.";
  case "channel":
    return "Find public communities, acquisition channels, launch surfaces, newsletters, cohorts, and places where target users discover tools.";
  case "platform":
    return "Find public platform, store, privacy, distribution, and integration constraints relevant to the project context.";
  default:
    return "Find public market validation evidence for this hypothesis.";
  }
}

function limitSnapshotCardsPerLane(snapshot = {}, {
  now = new Date(),
  rankedAnswers = [],
  selfReferenceProfile = null,
  adaptiveProfile = null,
} = {}) {
  return {
    ...snapshot,
    status: {
      ...(snapshot.status || {}),
      partialFailures: normalizePartialFailures(snapshot.status?.partialFailures || snapshot.status?.partial_failures),
    },
    lanes: (snapshot.lanes || []).map((lane) => dedupeAndLimitLaneCards(lane, {
      now,
      rankedAnswers,
      selfReferenceProfile,
      adaptiveProfile,
    })),
  };
}

function dedupeAndLimitLaneCards(lane = {}, {
  now = new Date(),
  rankedAnswers = [],
  selfReferenceProfile = null,
  adaptiveProfile = null,
} = {}) {
  const merged = [];
  for (const card of Array.isArray(lane.cards) ? lane.cards : []) {
    if (!card) continue;
    const sourceRefs = normalizeSourceRefs(card.sourceRefs || [], { selfReferenceProfile });
    if (!hasExternalWebSourceRef(sourceRefs)) continue;
    const domains = new Set(sourceRefs.filter((source) => source.url).map((source) => source.domain).filter(Boolean));
    const normalizedCard = {
      ...card,
      sourceRefs,
      confidence: normalizeCardConfidence(card.confidence, domains.size, sourceRefs),
      evidenceStrength: normalizeCardConfidence(card.evidenceStrength || card.confidence, domains.size, sourceRefs),
    };
    const existingIndex = findDuplicateCardIndex(merged, normalizedCard);
    if (existingIndex === -1) {
      merged.push(normalizedCard);
      continue;
    }
    merged[existingIndex] = mergeMarketRadarCards(merged[existingIndex], normalizedCard, {
      selfReferenceProfile,
    });
  }
  const cards = rankMarketRadarCards(merged, {
    now,
    rankedAnswers,
    adaptiveProfile,
  }).slice(0, NEWS_MARKET_RADAR_MAX_CARDS_PER_LANE);
  return {
    ...lane,
    impact: aggregateImpact(cards),
    confidence: aggregateConfidence(cards),
    cards,
  };
}

function findDuplicateCardIndex(cards, card) {
  const sourceKeys = new Set(sourceKeysForCard(card));
  const titleDomainKey = cardTitleDomainKey(card);
  return cards.findIndex((existing) => {
    if (sourceKeys.size > 0 && sourceKeysForCard(existing).some((key) => sourceKeys.has(key))) return true;
    return titleDomainKey && titleDomainKey === cardTitleDomainKey(existing);
  });
}

function mergeMarketRadarCards(a, b, { selfReferenceProfile = null } = {}) {
  const sourceRefs = normalizeSourceRefs([
    ...(a.sourceRefs || []),
    ...(b.sourceRefs || []),
  ], { selfReferenceProfile });
  const domains = new Set(sourceRefs.filter((source) => source.url).map((source) => source.domain).filter(Boolean));
  const relatedAnswerIds = normalizeStringArray([
    ...((a.relatedAnswerIds || [])),
    ...((b.relatedAnswerIds || [])),
  ], 8, 180);
  const relatedDays = normalizeIntArray([
    ...((a.relatedDays || [])),
    ...((b.relatedDays || [])),
  ], 1, 30, 8);
  const suggestedDocTargets = normalizeStringArray([
    ...((a.suggestedDocTargets || [])),
    ...((b.suggestedDocTargets || [])),
  ], 6, 80);
  return {
    ...a,
    title: chooseCardText(a.title, b.title, 220),
    summary: chooseCardText(a.summary, b.summary, 1_200),
    impact: aggregateImpact([a, b]),
    confidence: normalizeCardConfidence(maxConfidence(a.confidence, b.confidence), domains.size, sourceRefs),
    whyItMatters: chooseCardText(a.whyItMatters, b.whyItMatters, 1_200),
    suggestedHypothesisUpdate: chooseCardText(a.suggestedHypothesisUpdate, b.suggestedHypothesisUpdate, 1_500),
    suggestedDocTargets,
    relatedDays,
    relatedAnswerIds,
    sourceRefs,
    evidenceStrength: normalizeCardConfidence(maxConfidence(a.evidenceStrength, b.evidenceStrength), domains.size, sourceRefs),
  };
}

function rankMarketRadarCards(cards = [], {
  now = new Date(),
  rankedAnswers = [],
  adaptiveProfile = null,
} = {}) {
  return cards
    .map((card, index) => ({
      card,
      index,
      score: scoreMarketRadarCard(card, { now, rankedAnswers, adaptiveProfile }),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((item) => item.card);
}

function scoreMarketRadarCard(card = {}, {
  now = new Date(),
  rankedAnswers = [],
  adaptiveProfile = null,
} = {}) {
  const confidenceScore = ({ weak: 0, medium: 3, strong: 6 })[normalizeConfidence(card.confidence)] || 0;
  const impactScore = ({ strengthens: 2, weakens: 2, mixed: 1, unknown: 0 })[normalizeImpact(card.impact)] || 0;
  const sourceSummary = summarizeMarketRadarCardSources(card.sourceRefs || [], { now, adaptiveProfile });
  const relevanceText = [
    card.title,
    card.summary,
    card.whyItMatters,
    card.suggestedHypothesisUpdate,
    ...(card.sourceRefs || []).flatMap((source) => [source.title, source.excerpt]),
  ].filter(Boolean).join(" ");
  return confidenceScore
    + impactScore
    + sourceSummary.sourceTrustScore
    + sourceSummary.categoryDiversityScore
    + sourceSummary.buyingSignalScore
    + sourceSummary.freshnessScore
    + sourceSummary.localeRelevanceScore
    + adaptiveTextRelevanceScore(relevanceText, adaptiveProfile, 3)
    + answerRelevanceScore(card, rankedAnswers);
}

function summarizeMarketRadarCardSources(sourceRefs = [], {
  now = new Date(),
  adaptiveProfile = null,
} = {}) {
  const webSources = sourceRefs.filter((source) => source.url && source.sourceType !== "workspace");
  const annotations = webSources.map((source) => annotateMarketRadarSourceTrust(source));
  const categories = new Set(annotations.map((annotation) => annotation.category).filter((category) => category !== "unknown"));
  const sourceTrustScore = Math.min(6, annotations.reduce((sum, annotation) => sum + annotation.score, 0));
  return {
    sourceTrustScore,
    categoryDiversityScore: categories.size >= 2 ? 1 : 0,
    buyingSignalScore: webSources.some(sourceHasBuyingSignal) ? 1 : 0,
    freshnessScore: webSources.some((source) => isFreshMarketRadarSource(source, now)) ? 1 : 0,
    localeRelevanceScore: Math.min(4, webSources.reduce((sum, source) => (
      sum + adaptiveLocaleSourceScore(source, adaptiveProfile)
    ), 0)),
    communityOnly: webSources.length > 0
      && annotations.length === webSources.length
      && annotations.every((annotation) => annotation.trustTier === "community"),
  };
}

function sourceHasBuyingSignal(source = {}) {
  return MARKET_RADAR_BUYING_SIGNAL_PATTERN.test([
    source.url,
    source.title,
    source.excerpt,
  ].filter(Boolean).join(" "));
}

function isFreshMarketRadarSource(source = {}, now = new Date()) {
  const publishedAtMs = Date.parse(source.publishedAt || "");
  const nowMs = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  return Number.isFinite(publishedAtMs)
    && publishedAtMs <= nowMs
    && nowMs - publishedAtMs <= FRESH_SOURCE_WINDOW_MS;
}

function answerRelevanceScore(card = {}, rankedAnswers = []) {
  const weightsByAnswerId = new Map((rankedAnswers || []).map((answer) => [
    answer.id,
    Number.isFinite(answer.marketRadarWeight) ? answer.marketRadarWeight : 0,
  ]));
  const relatedIds = Array.isArray(card.relatedAnswerIds) ? card.relatedAnswerIds : [];
  const rawScore = relatedIds.reduce((sum, answerId) => sum + (weightsByAnswerId.get(answerId) || 0), 0);
  return Math.min(3, rawScore);
}

function chooseCardText(a = "", b = "", maxLength = 500) {
  const first = cleanString(a || "", maxLength);
  const second = cleanString(b || "", maxLength);
  if (!first) return second;
  if (!second) return first;
  return second.length > first.length ? second : first;
}

function maxConfidence(a = "", b = "") {
  const order = { weak: 0, medium: 1, strong: 2 };
  const first = normalizeConfidence(a);
  const second = normalizeConfidence(b);
  return order[second] > order[first] ? second : first;
}

function sourceKeysForCard(card = {}) {
  return (card.sourceRefs || [])
    .map((source) => canonicalMarketRadarSourceKey(source))
    .filter(Boolean);
}

function cardTitleDomainKey(card = {}) {
  const title = normalizeDedupeText(card.title || "");
  const domain = (card.sourceRefs || []).find((source) => source.domain)?.domain || "";
  return title && domain ? `${title}|${domain}` : "";
}

function normalizeDedupeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function dedupeSourceRefs(sources = []) {
  const seen = new Map();
  for (const source of sources) {
    const key = canonicalMarketRadarSourceKey(source);
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, source);
      continue;
    }
    const previous = seen.get(key);
    seen.set(key, {
      ...previous,
      title: chooseCardText(previous.title, source.title, 220),
      excerpt: chooseCardText(previous.excerpt, source.excerpt, 700),
      publishedAt: previous.publishedAt || source.publishedAt,
    });
  }
  return [...seen.values()];
}

export function canonicalMarketRadarSourceKey(source = {}) {
  if (source.url) return canonicalUrlKey(source.url);
  if (source.path) return `path:${String(source.path).trim()}`;
  if (source.excerpt) return `excerpt:${normalizeDedupeText(source.excerpt).slice(0, 120)}`;
  return "";
}

function canonicalUrlKey(rawUrl = "") {
  try {
    const parsed = new URL(String(rawUrl || ""));
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const keptParams = [];
    for (const [key, value] of parsed.searchParams.entries()) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.startsWith("utm_")
        || ["ref", "fbclid", "gclid", "mc_cid", "mc_eid", "igshid"].includes(normalizedKey)
      ) {
        continue;
      }
      keptParams.push([key, value]);
    }
    keptParams.sort(([a], [b]) => a.localeCompare(b));
    parsed.search = "";
    for (const [key, value] of keptParams) {
      parsed.searchParams.append(key, value);
    }
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return `url:${parsed.toString()}`;
  } catch {
    return "";
  }
}

function statusForSnapshot(value = {}, now = new Date()) {
  const state = ["idle", "refreshing", "ready", "stale", "failed"].includes(value?.state)
    ? value.state
    : "idle";
  const stepIndex = clampInt(value?.stepIndex ?? value?.step_index, 1, 100, null);
  const stepCount = clampInt(value?.stepCount ?? value?.step_count, 1, 100, null);
  return {
    state,
    lastSuccessAt: value?.lastSuccessAt || (state === "ready" ? now.toISOString() : null),
    stale: Boolean(value?.stale || state === "stale"),
    error: cleanString(value?.error || "", 1_000) || null,
    reason: cleanString(value?.reason || "", 120) || null,
    researchSource: cleanString(value?.researchSource || value?.research_source || "", 160) || null,
    stage: cleanString(value?.stage || "", 120) || null,
    progressText: cleanString(value?.progressText || value?.progress_text || "", 240) || null,
    elapsedMs: clampInt(value?.elapsedMs ?? value?.elapsed_ms, 0, DAY_MS, null),
    stepIndex,
    stepCount,
    partialFailures: normalizePartialFailures(value?.partialFailures || value?.partial_failures),
  };
}

function notifyNewsMarketRadarProgress(onProgress, {
  stage = "",
  progressText = "",
  researchSource = null,
} = {}) {
  if (typeof onProgress !== "function") return;
  const normalizedStage = cleanString(stage, 120) || "checking_exa_route";
  const step = NEWS_MARKET_RADAR_PROGRESS_BY_STAGE.get(normalizedStage) || null;
  const payload = {
    state: "refreshing",
    stage: normalizedStage,
    progressText: cleanString(progressText || step?.progressText || "", 240) || null,
    researchSource: cleanString(researchSource || "", 160) || null,
    stepIndex: step?.stepIndex || null,
    stepCount: NEWS_MARKET_RADAR_PROGRESS_STEPS.length,
  };
  onProgress(payload);
}

function normalizeExaResearchRoutes({
  exaApiKey = "",
  exaMcpConfig = null,
  exaResearchRoute = null,
  exaResearchRoutes = [],
} = {}) {
  const routes = Array.isArray(exaResearchRoutes)
    ? exaResearchRoutes
    : [];
  const normalized = routes
    .map(normalizeExaResearchRoute)
    .filter(Boolean);
  if (normalized.length > 0) return normalized;
  const single = normalizeExaResearchRoute({
    ...(exaResearchRoute || {}),
    mcpConfig: exaMcpConfig,
  });
  if (single) return [single];
  const key = String(exaApiKey || "").trim();
  if (!key) return [];
  return [{
    provider: "",
    source: "api_key",
    label: "EXA_API_KEY fallback",
    mcpConfig: buildExaMcpConfig(key),
  }];
}

function normalizeExaResearchRoute(route = {}) {
  if (!route || typeof route !== "object") return null;
  const mcpConfig = route.mcpConfig && typeof route.mcpConfig === "object"
    ? route.mcpConfig
    : null;
  if (!mcpConfig) return null;
  return {
    provider: cleanString(route.provider || "", 80),
    source: cleanString(route.source || "", 80),
    label: cleanString(route.label || "", 160) || "Exa MCP",
    serverName: cleanString(route.serverName || "", 120),
    configPath: route.configPath ? cleanString(route.configPath, 1_000) : null,
    mcpConfig: normalizeMarketRadarMcpConfig(mcpConfig),
  };
}

function normalizeMarketRadarMcpConfig(mcpConfig = {}) {
  if (!mcpConfig || typeof mcpConfig !== "object") return mcpConfig;
  if (typeof mcpConfig.url !== "string" || !mcpConfig.url.trim()) return mcpConfig;
  return {
    ...mcpConfig,
    url: marketRadarExaMcpUrl(mcpConfig.url.trim()),
  };
}

function summarizeExaResearchRoute(route = {}) {
  if (!route) return null;
  return {
    provider: route.provider || "",
    source: route.source || "",
    label: route.label || "",
    serverName: route.serverName || "",
    configPath: route.configPath || null,
  };
}

function makeEmptyLane(id) {
  return {
    id,
    title: NEWS_LANE_TITLES[id],
    hypothesis: NEWS_LANE_HYPOTHESES[id],
    impact: "unknown",
    confidence: "weak",
    cards: [],
  };
}

function makeProviderSchemaExample() {
  return {
    schemaVersion: NEWS_MARKET_RADAR_SCHEMA_VERSION,
    contentLocale: NEWS_MARKET_RADAR_CONTENT_LOCALE,
    promptProfile: NEWS_MARKET_RADAR_PROMPT_PROFILE,
    generatedAt: "ISO-8601",
    status: {
      state: "ready",
      reason: "manual",
      researchSource: "Codex Exa MCP",
      partialFailures: [],
    },
    lanes: [
      {
        id: "alternatives_pricing",
        title: "대안/가격",
        hypothesis: "이미 돈을 쓰는 대안과 가격 기준은 무엇인가",
        impact: "strengthens|weakens|mixed|unknown",
        confidence: "weak|medium|strong",
        cards: [
          {
            id: "stable-id",
            title: "짧은 한국어 신호 제목",
            summary: "1-3문장 한국어 종합. 숫자와 가격은 그대로 보존합니다.",
            impact: "strengthens|weakens|mixed|unknown",
            confidence: "weak|medium|strong",
            whyItMatters: "이 근거가 사용자의 다음 행동을 어떻게 바꾸는지 한국어로 설명",
            suggestedHypothesisUpdate: "자동 수정이 아니라 한국어 문장으로 쓴 가설 갱신 제안",
            suggestedDocTargets: ["ICP.md", "SPEC.md"],
            relatedDays: [2, 5, 27],
            relatedAnswerIds: [],
            sourceRefs: [
              {
                sourceType: "web",
                title: "공식 페이지 제목 또는 원문 제목",
                url: "https://example.com/page",
                domain: "example.com",
                publishedAt: "",
                excerpt: "근거 문장을 한국어로 짧게 요약. 제품명과 가격은 유지.",
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeLaneProviderSchemaExample() {
  return {
    lane: {
      id: "alternatives_pricing",
      title: "대안/가격",
      hypothesis: "이미 돈을 쓰는 대안과 가격 기준은 무엇인가",
      impact: "strengthens|weakens|mixed|unknown",
      confidence: "weak|medium|strong",
      cards: [
        {
          id: "stable-id",
          title: "짧은 한국어 신호 제목",
          summary: "1-3문장 한국어 종합. 숫자와 가격은 그대로 보존합니다.",
          impact: "strengthens|weakens|mixed|unknown",
          confidence: "weak|medium|strong",
          whyItMatters: "이 근거가 사용자의 다음 행동을 어떻게 바꾸는지 한국어로 설명",
          suggestedHypothesisUpdate: "자동 수정이 아니라 한국어 문장으로 쓴 가설 갱신 제안",
          suggestedDocTargets: ["ICP.md", "SPEC.md"],
          relatedDays: [2, 5, 27],
          relatedAnswerIds: [],
          sourceRefs: [
            {
              sourceType: "web",
              title: "공식 페이지 제목 또는 원문 제목",
              url: "https://example.com/page",
              domain: "example.com",
              publishedAt: "",
              excerpt: "근거 문장을 한국어로 짧게 요약. 제품명과 가격은 유지.",
            },
          ],
        },
      ],
    },
  };
}

function scanResultCandidates(scanResult = {}) {
  const roles = ["icp", "spec", "goal", "values", "designSystem", "adr", "docs"];
  return roles
    .map((role) => {
      const value = scanResult?.[role];
      if (!value) return null;
      return {
        role,
        relativePath: String(value),
        title: path.basename(String(value)),
      };
    })
    .filter(Boolean);
}

function dedupeEvidenceCandidates(candidates) {
  const seen = new Set();
  const output = [];
  for (const candidate of candidates) {
    const key = String(candidate.relativePath || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(candidate);
  }
  return output;
}

function normalizeRelativeWorkspacePath(value, root) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return "";
  return path.relative(root, resolved);
}

function isDeniedRelativePath(relativePath) {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  if (segments.some((segment) => DENIED_PATH_SEGMENTS.has(segment))) return true;
  return segments.some((segment) => SECRETISH_FILENAME_PATTERN.test(segment));
}

function normalizeOnboardingHypothesis(value = {}) {
  return {
    productName: cleanString(value?.productName, 160),
    targetUser: cleanString(value?.targetUser, 500),
    likelyUsers: normalizeStringArray(value?.likelyUsers, 8, 160),
    confidence: cleanString(value?.confidence, 80),
  };
}

function inferProductNameFromEvidence(evidence = []) {
  const readme = evidence.find((item) => item.path === "README.md" || item.role === "readme");
  const titleMatch = readme?.excerpt?.match(/^#\s+(.+)$/m);
  return titleMatch?.[1]?.trim() || "";
}

function firstMatchingEvidenceLine(evidence = [], pattern) {
  for (const item of evidence || []) {
    const lines = String(item.excerpt || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const found = lines.find((line) => pattern.test(line));
    if (found) return found;
  }
  return "";
}

function pruneRecordsByRetention(records = [], { now = new Date(), dateKey = "occurredAt" } = {}) {
  const cutoff = now.getTime() - NEWS_MARKET_RADAR_RETENTION_DAYS * DAY_MS;
  return records.filter((record) => {
    const ts = Date.parse(record?.[dateKey] || "");
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

async function readJsonFile(filePath, fsImpl = fs) {
  try {
    return JSON.parse(await fsImpl.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeIsoDate(value, fallback = new Date()) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return fallback.toISOString();
}

function cleanString(value, maxLength = 500) {
  const text = redactPrivateQueryText(value).trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeStringArray(value, maxItems = 12, maxLength = 160) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function uniqueStrings(value, maxItems = 12, maxLength = 256) {
  const output = [];
  for (const item of Array.isArray(value) ? value : []) {
    const text = cleanString(item, maxLength);
    if (!text) continue;
    if (output.some((previous) => normalizeDedupeText(previous) === normalizeDedupeText(text))) continue;
    output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

function normalizeIntArray(value, min, max, maxItems) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => clampInt(item, min, max, null))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .slice(0, maxItems);
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeImpact(value) {
  const normalized = String(value || "").trim();
  return ["strengthens", "weakens", "mixed", "unknown"].includes(normalized) ? normalized : "unknown";
}

function normalizeConfidence(value) {
  const normalized = String(value || "").trim();
  return ["weak", "medium", "strong"].includes(normalized) ? normalized : "weak";
}

function normalizeCardConfidence(value, domainCount, sourceRefs = []) {
  const confidence = value ? normalizeConfidence(value) : confidenceFromSourceCount(domainCount);
  if (confidence === "strong" && domainCount < 2) return "weak";
  if (confidence === "strong" && summarizeMarketRadarCardSources(sourceRefs).communityOnly) return "medium";
  return confidence;
}

function confidenceFromSourceCount(domainCount) {
  if (domainCount >= 2) return "strong";
  if (domainCount === 1) return "weak";
  return "weak";
}

function aggregateImpact(cards) {
  const impacts = new Set(cards.map((card) => card.impact).filter((impact) => impact !== "unknown"));
  if (impacts.size > 1) return "mixed";
  return impacts.values().next().value || "unknown";
}

function aggregateConfidence(cards) {
  if (cards.some((card) => card.confidence === "strong")) return "strong";
  if (cards.some((card) => card.confidence === "medium")) return "medium";
  return "weak";
}

function domainFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extractJsonObject(text) {
  const value = String(text || "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return "";
  return value.slice(start, end + 1);
}

function safeTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function truncateForPrompt(value) {
  const encoded = JSON.stringify(value);
  if (encoded.length <= MAX_PROVIDER_PROMPT_CHARS) return value;
  const copy = JSON.parse(encoded);
  copy.evidence = (copy.evidence || []).map((item) => ({
    ...item,
    excerpt: String(item.excerpt || "").slice(0, 3_000),
  }));
  copy.answers = (copy.answers || []).slice(0, 12);
  return copy;
}

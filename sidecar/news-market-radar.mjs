import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import { sanitizeWebSearchQuery } from "./read-only-workspace-tool-policy.mjs";

export const NEWS_MARKET_RADAR_SCHEMA_VERSION = 1;
export const NEWS_MARKET_RADAR_CACHE_SCHEMA_VERSION = 1;
export const CURRICULUM_ANSWER_LOG_SCHEMA_VERSION = 1;
export const NEWS_MARKET_RADAR_RETENTION_DAYS = 30;
export const NEWS_MARKET_RADAR_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
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

export function resolveCurriculumAnswerLogPath(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "curriculum-answer-log.json");
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
    url: "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa",
    headers: {
      "x-api-key": key,
    },
  };
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
} = {}) {
  const cachePath = resolveNewsMarketRadarCachePath(workspaceRoot);
  const raw = await readJsonFile(cachePath, fsImpl);
  if (raw?.snapshot) {
    return normalizeNewsMarketRadarSnapshot(raw.snapshot, {
      now,
      fallbackStatus: statusForSnapshot(raw.snapshot.status, now),
    });
  }
  const configured = exaConfigured || Boolean(String(exaApiKey || "").trim());
  return makeEmptyNewsMarketRadarSnapshot({
    now,
    status: configured ? "idle" : "failed",
    error: configured ? null : "Exa MCP is not configured.",
    reason: configured ? "not_loaded" : "exa_mcp_missing",
  });
}

export async function persistNewsMarketRadarSnapshot({
  workspaceRoot,
  snapshot,
  rawProviderResult = null,
  now = new Date(),
} = {}) {
  const cachePath = resolveNewsMarketRadarCachePath(workspaceRoot);
  const runsDir = resolveNewsMarketRadarRunsDir(workspaceRoot);
  const normalized = normalizeNewsMarketRadarSnapshot(snapshot, { now });
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
  scanResult = {},
  onboardingHypothesis = null,
  now = new Date(),
  fsImpl = fs,
} = {}) {
  const key = String(exaApiKey || "").trim();
  const routes = normalizeExaResearchRoutes({
    exaApiKey: key,
    exaMcpConfig,
    exaResearchRoute,
    exaResearchRoutes,
  });
  const primaryRoute = routes[0] || null;
  const previous = await loadNewsMarketRadarSnapshot({
    workspaceRoot,
    now,
    fsImpl,
    exaApiKey: key,
    exaConfigured: routes.length > 0,
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
  if (!force && previous.status?.state === "ready" && previous.generatedAt) {
    const ageMs = now.getTime() - Date.parse(previous.generatedAt);
    if (Number.isFinite(ageMs) && ageMs < NEWS_MARKET_RADAR_REFRESH_INTERVAL_MS) {
      return previous;
    }
  }
  if (typeof providerResearcher !== "function") {
    throw new Error("news market radar requires a providerResearcher.");
  }

  const [answerLog, workspaceEvidence] = await Promise.all([
    loadCurriculumAnswerLog({ workspaceRoot, now, fsImpl }),
    collectWorkspaceEvidence({ workspaceRoot, scanResult, onboardingHypothesis, fsImpl }),
  ]);
  const rankedAnswers = rankAnswersForMarketRadar(answerLog.records, { now }).slice(0, 20);
  const context = buildMarketRadarResearchContext({
    workspaceRoot,
    workspaceEvidence,
    answers: rankedAnswers,
    now,
  });
  const rawProviderResult = await providerResearcher({
    context,
    prompt: buildMarketRadarProviderPrompt(context),
    exaMcpConfig: primaryRoute.mcpConfig,
    exaResearchRoute: summarizeExaResearchRoute(primaryRoute),
    exaResearchRoutes: routes,
    exaApiKeyConfigured: Boolean(key),
    reason,
  });
  const researchSource = cleanString(
    rawProviderResult?.researchSource
      || rawProviderResult?.research_source
      || rawProviderResult?.exaResearchSource
      || primaryRoute.label
      || "",
    160,
  ) || null;
  const providerSnapshot = extractProviderSnapshot(rawProviderResult);
  const normalized = normalizeNewsMarketRadarSnapshot(providerSnapshot, {
    now,
    workspaceEvidence,
    rankedAnswers,
    fallbackStatus: {
      state: "ready",
      lastSuccessAt: now.toISOString(),
      stale: false,
      error: null,
      reason,
      researchSource,
    },
  });
  return persistNewsMarketRadarSnapshot({
    workspaceRoot,
    snapshot: normalized,
    rawProviderResult,
    now,
  });
}

export function buildMarketRadarResearchContext({
  workspaceRoot,
  workspaceEvidence = {},
  answers = [],
  now = new Date(),
} = {}) {
  const hypothesis = normalizeOnboardingHypothesis(workspaceEvidence.onboardingHypothesis);
  const productName = cleanString(
    hypothesis.productName
      || inferProductNameFromEvidence(workspaceEvidence.evidence)
      || path.basename(path.resolve(String(workspaceRoot || "."))),
    160,
  );
  const targetUser = cleanString(
    hypothesis.targetUser || firstMatchingEvidenceLine(workspaceEvidence.evidence, /(ICP|target|사용자|persona)/i),
    500,
  );
  const problem = cleanString(
    firstMatchingEvidenceLine(workspaceEvidence.evidence, /(pain|problem|통증|문제|cost|비용)/i),
    500,
  );
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
  const querySeeds = [
    productName,
    targetUser,
    problem,
    ...answerSummaries.slice(0, 8).flatMap((answer) => [answer.dimension, answer.answer]),
  ]
    .map(redactPrivateQueryText)
    .map(sanitizeWebSearchQuery)
    .filter(Boolean)
    .slice(0, 12);
  return truncateForPrompt({
    generatedAt: now.toISOString(),
    workspace: {
      basename: path.basename(path.resolve(String(workspaceRoot || "."))),
    },
    productName,
    targetUser,
    problem,
    marketLocale: "global_plus_korean",
    priority: "paid alternatives, pricing, reviews, buying behavior, public product/store pages",
    evidence: (workspaceEvidence.evidence || []).map((item) => ({
      id: item.id,
      role: item.role,
      path: item.path,
      title: item.title,
      excerpt: item.excerpt,
    })),
    answers: answerSummaries,
    querySeeds,
    lanes: NEWS_LANE_IDS.map((id) => ({
      id,
      title: NEWS_LANE_TITLES[id],
      hypothesis: NEWS_LANE_HYPOTHESES[id],
    })),
  });
}

export function buildMarketRadarProviderPrompt(context) {
  return [
    "You are Agentic30 Market Radar. Use Exa MCP web_search_exa and web_fetch_exa for public market research.",
    "Return ONLY strict JSON. No markdown fences.",
    "",
    "Goal:",
    "- Find public evidence about paid alternatives, pricing, reviews, buying/conversion behavior, product/store/pricing pages, and community discussions.",
    "- Adapt the evidence to the user's workspace docs and Day 1-30 answers.",
    "- Do not propose automatic edits. Suggest hypothesis updates only.",
    "",
    "Evidence policy:",
    "- Strong confidence requires at least 2 independent source domains pointing in the same direction.",
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

export function normalizeNewsMarketRadarSnapshot(
  value = {},
  {
    now = new Date(),
    workspaceEvidence = null,
    rankedAnswers = [],
    fallbackStatus = null,
  } = {},
) {
  const status = statusForSnapshot({
    ...(fallbackStatus || {}),
    ...(value.status || {}),
  }, now);
  const lanesById = new Map();
  for (const lane of Array.isArray(value.lanes) ? value.lanes : []) {
    const normalizedLane = normalizeLane(lane, { now, rankedAnswers });
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
    },
    lanes: NEWS_LANE_IDS.map(makeEmptyLane),
  }, { now });
}

export function extractProviderSnapshot(rawProviderResult) {
  if (!rawProviderResult) return {};
  if (typeof rawProviderResult === "object" && rawProviderResult.snapshot) return rawProviderResult.snapshot;
  if (typeof rawProviderResult === "object" && Array.isArray(rawProviderResult.lanes)) return rawProviderResult;
  const text = typeof rawProviderResult === "string"
    ? rawProviderResult
    : String(rawProviderResult.text || rawProviderResult.content || "");
  const jsonText = extractJsonObject(text);
  if (!jsonText) throw new Error("news market radar provider did not return JSON.");
  return JSON.parse(jsonText);
}

function normalizeLane(value = {}, { rankedAnswers = [] } = {}) {
  const id = NEWS_LANE_IDS.includes(value.id) ? value.id : "problem";
  const cards = Array.isArray(value.cards)
    ? value.cards.map((card, index) => normalizeCard(card, { laneId: id, index, rankedAnswers })).filter(Boolean)
    : [];
  return {
    id,
    title: cleanString(value.title || NEWS_LANE_TITLES[id], 120),
    hypothesis: cleanString(value.hypothesis || NEWS_LANE_HYPOTHESES[id], 300),
    impact: normalizeImpact(value.impact || aggregateImpact(cards)),
    confidence: normalizeConfidence(value.confidence || aggregateConfidence(cards)),
    cards,
  };
}

function normalizeCard(value = {}, { laneId, index, rankedAnswers = [] } = {}) {
  const sourceRefs = normalizeSourceRefs(value.sourceRefs ?? value.sources ?? []);
  const domains = new Set(sourceRefs.filter((source) => source.url).map((source) => source.domain).filter(Boolean));
  const confidence = normalizeConfidence(value.confidence || confidenceFromSourceCount(domains.size));
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

function normalizeSourceRefs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((source, index) => {
      const url = cleanString(source.url || "", 1_000);
      const domain = cleanString(source.domain || domainFromUrl(url), 160);
      const pathValue = cleanString(source.path || source.filePath || "", 500);
      const sourceType = cleanString(source.sourceType || source.type || (url ? "web" : "workspace"), 80);
      return {
        id: cleanString(source.id || `${sourceType}-${domain || pathValue || index}`, 220),
        sourceType,
        title: cleanString(source.title || domain || pathValue || "source", 220),
        url,
        domain,
        path: pathValue,
        publishedAt: cleanString(source.publishedAt || source.published_at || "", 80),
        excerpt: cleanString(source.excerpt || source.quote || "", 700),
      };
    })
    .filter((source) => source.url || source.path || source.excerpt)
    .slice(0, 12);
}

function normalizeWorkspaceRefs(value, workspaceEvidence) {
  if (Array.isArray(value)) {
    return normalizeSourceRefs(value);
  }
  return normalizeSourceRefs((workspaceEvidence?.evidence || []).slice(0, 8));
}

function statusForSnapshot(value = {}, now = new Date()) {
  const state = ["idle", "refreshing", "ready", "stale", "failed"].includes(value?.state)
    ? value.state
    : "idle";
  return {
    state,
    lastSuccessAt: value?.lastSuccessAt || (state === "ready" ? now.toISOString() : null),
    stale: Boolean(value?.stale || state === "stale"),
    error: cleanString(value?.error || "", 1_000) || null,
    reason: cleanString(value?.reason || "", 120) || null,
    researchSource: cleanString(value?.researchSource || value?.research_source || "", 160) || null,
  };
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
    mcpConfig,
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
    generatedAt: "ISO-8601",
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
            title: "short signal title",
            summary: "1-3 sentence synthesis",
            impact: "strengthens|weakens|mixed|unknown",
            confidence: "weak|medium|strong",
            whyItMatters: "why this changes the user's next action",
            suggestedHypothesisUpdate: "proposed diff in prose, not an automatic edit",
            suggestedDocTargets: ["ICP.md", "SPEC.md"],
            relatedDays: [2, 5, 27],
            relatedAnswerIds: [],
            sourceRefs: [
              {
                sourceType: "web",
                title: "source title",
                url: "https://example.com/page",
                domain: "example.com",
                publishedAt: "",
                excerpt: "short supporting excerpt",
              },
            ],
          },
        ],
      },
    ],
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

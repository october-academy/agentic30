import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { atomicWriteJson } from "./atomic-store.mjs";
import { projectDocDefinitions } from "./project-doc-paths.mjs";

export const STRATEGY_REPORT_SCHEMA_VERSION = 1;
export const STRATEGY_REPORT_CACHE_SCHEMA_VERSION = 1;
export const STRATEGY_REPORT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const STRATEGY_REPORT_RETENTION_DAYS = 30;
export const STRATEGY_REPORT_CONTENT_LOCALE = "ko-KR";
export const STRATEGY_REPORT_PROMPT_PROFILE = "ko_strategy_report_v1_three_pass_exa";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVIDENCE_CHARS_PER_DOC = 12_000;
const MAX_PROVIDER_PROMPT_CHARS = 44_000;
const REQUIRED_CANVAS_BLOCK_IDS = Object.freeze([
  "partners",
  "activities",
  "resources",
  "value-proposition",
  "relationships",
  "channels",
  "customer-segments",
  "cost-structure",
  "revenue-streams",
]);
const REQUIRED_SWOT_GROUP_IDS = Object.freeze([
  "strengths",
  "weaknesses",
  "opportunities",
  "threats",
]);

export const STRATEGY_REPORT_PROGRESS_STEPS = Object.freeze([
  {
    stage: "checking_exa_route",
    stepIndex: 1,
    progressText: "Exa MCP 연결을 확인하는 중",
  },
  {
    stage: "loading_strategy_context",
    stepIndex: 2,
    progressText: "전략 근거 문서를 읽는 중",
  },
  {
    stage: "running_exa_research",
    stepIndex: 3,
    progressText: "Exa 공개 근거로 전략 리포트를 조사하는 중",
  },
  {
    stage: "running_adversarial_review",
    stepIndex: 4,
    progressText: "적대적 리뷰로 약한 가정과 누락 근거를 찾는 중",
  },
  {
    stage: "running_multidimensional_review",
    stepIndex: 5,
    progressText: "다차원 리뷰와 최종 검증으로 섹션 품질을 맞추는 중",
  },
  {
    stage: "saving_results",
    stepIndex: 6,
    progressText: "전략 리포트를 로컬 캐시에 저장하는 중",
  },
]);

const STRATEGY_REPORT_PROGRESS_BY_STAGE = new Map(
  STRATEGY_REPORT_PROGRESS_STEPS.map((step) => [step.stage, step]),
);

const STRATEGY_EVIDENCE_CANDIDATES = Object.freeze([
  { role: "strategy", relativePath: "docs/strategy/agentic30-business-strategy-data.md", title: "strategy-data" },
  { role: "strategy", relativePath: "docs/strategy/README.md", title: "strategy-readme" },
  ...projectDocDefinitions(["spec", "icp", "values", "goal"])
    .flatMap((doc) => doc.aliases.map((relativePath) => ({
      role: doc.type,
      relativePath,
      title: doc.filename,
    }))),
  { role: "readme", relativePath: "README.md", title: "README.md" },
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

const SECRET_TOKEN_PATTERNS = Object.freeze([
  /sk-[A-Za-z0-9_\-]{8,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /xox[baprs]-[A-Za-z0-9_-]{10,}/g,
  /AIza[A-Za-z0-9_\-]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
]);

const PRIVATE_RAW_TEXT_PATTERN = /(raw\s+private|private\s+alignment|interview\s+transcript|transcript\s+says|token\s+sk-|api[_ -]?key|password|credential)/i;

const StrategyReportStringSchema = z.string().trim().min(1);
const StrategyReportOptionalStringSchema = z.string().trim().optional();
const StrategyReportToneSchema = z.string().trim().max(40).optional();

const StrategyReportSummaryTileSchema = z.object({
  id: StrategyReportStringSchema.max(80),
  label: StrategyReportStringSchema.max(80),
  title: StrategyReportStringSchema.max(160),
  detail: StrategyReportStringSchema.max(360),
}).passthrough();

const StrategyReportCriteriaRowSchema = z.object({
  id: StrategyReportStringSchema.max(80),
  label: StrategyReportStringSchema.max(80),
  value: StrategyReportStringSchema.max(500),
}).passthrough();

const StrategyReportCanvasBlockSchema = z.object({
  id: StrategyReportStringSchema.max(80),
  number: StrategyReportOptionalStringSchema,
  eyebrow: StrategyReportOptionalStringSchema,
  title: StrategyReportStringSchema.max(120),
  tone: StrategyReportToneSchema,
  bullets: z.array(StrategyReportStringSchema.max(280)).min(1).max(8),
}).passthrough();

const StrategyReportCompetitorSchema = z.object({
  id: StrategyReportStringSchema.max(80),
  title: StrategyReportStringSchema.max(120),
  tag: StrategyReportStringSchema.max(180),
  body: StrategyReportStringSchema.max(600),
  gap: StrategyReportStringSchema.max(420),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  adaptiveScore: z.number().int().min(0).max(100),
  evidenceScore: z.number().int().min(0).max(100),
  sourceLabel: StrategyReportStringSchema.max(160),
  sourceURL: z.string().trim().max(500).optional(),
  sourceDisplay: StrategyReportOptionalStringSchema,
  verifiedAt: StrategyReportOptionalStringSchema,
  scoreRationale: StrategyReportStringSchema.max(500),
  category: StrategyReportOptionalStringSchema,
  isAgentic30: z.boolean().optional(),
  labelPlacement: StrategyReportOptionalStringSchema,
}).passthrough();

const StrategyReportSwotGroupSchema = z.object({
  id: StrategyReportStringSchema.max(80),
  title: StrategyReportStringSchema.max(120),
  tag: StrategyReportStringSchema.max(80),
  tone: StrategyReportToneSchema,
  bullets: z.array(StrategyReportStringSchema.max(300)).min(1).max(8),
}).passthrough();

const StrategyReportSourceRefSchema = z.object({
  id: StrategyReportOptionalStringSchema,
  sourceType: StrategyReportOptionalStringSchema,
  title: StrategyReportStringSchema.max(220),
  url: z.string().trim().max(500).nullable().optional(),
  domain: StrategyReportOptionalStringSchema.nullable(),
  path: z.string().trim().max(500).nullable().optional(),
  publishedAt: StrategyReportOptionalStringSchema.nullable(),
  excerpt: StrategyReportOptionalStringSchema.nullable(),
}).passthrough();

export const StrategyReportContentContract = z.object({
  commandLine: StrategyReportStringSchema.max(240),
  diagnosisKicker: StrategyReportStringSchema.max(80),
  diagnosisTitle: StrategyReportStringSchema.max(360),
  diagnosisLead: StrategyReportStringSchema.max(800),
  positioningStatement: StrategyReportStringSchema.max(500),
  judgement: StrategyReportStringSchema.max(900),
  generatedBadge: StrategyReportOptionalStringSchema,
  analysisBasisLabel: StrategyReportStringSchema.max(160),
  canvasMeta: StrategyReportOptionalStringSchema,
  matrixMeta: StrategyReportOptionalStringSchema,
  swotMeta: StrategyReportOptionalStringSchema,
  summaryTiles: z.array(StrategyReportSummaryTileSchema).min(3).max(6),
  criteriaRows: z.array(StrategyReportCriteriaRowSchema).min(4).max(12),
  canvasBlocks: z.array(StrategyReportCanvasBlockSchema).min(9).max(12),
  competitors: z.array(StrategyReportCompetitorSchema).min(3).max(12),
  swotGroups: z.array(StrategyReportSwotGroupSchema).min(4).max(8),
  swotMatrixColumnCount: z.number().int().min(1).max(4).optional(),
  swotMatrixRows: z.array(z.array(StrategyReportStringSchema.max(80)).min(1).max(4)).max(4).optional(),
  sourceRefs: z.array(StrategyReportSourceRefSchema).max(24).optional(),
  searchableCopy: z.array(StrategyReportStringSchema.max(500)).max(80).optional(),
  businessCanvasTopRows: z.array(z.array(StrategyReportStringSchema.max(80)).min(1).max(6)).max(6).optional(),
  businessCanvasBottomRow: z.array(StrategyReportStringSchema.max(80)).max(10).optional(),
  generatedAt: StrategyReportOptionalStringSchema,
}).passthrough().superRefine((report, context) => {
  const canvasIds = new Set(report.canvasBlocks.map((block) => block.id));
  for (const id of REQUIRED_CANVAS_BLOCK_IDS) {
    if (!canvasIds.has(id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canvasBlocks"],
        message: `missing required canvas block ${id}`,
      });
    }
  }
  if (!report.competitors.some((competitor) => competitor.id === "agentic30" && competitor.isAgentic30 === true)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["competitors"],
      message: "missing required Agentic30 competitor with isAgentic30=true",
    });
  }
  const swotIds = new Set(report.swotGroups.map((group) => group.id));
  for (const id of REQUIRED_SWOT_GROUP_IDS) {
    if (!swotIds.has(id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["swotGroups"],
        message: `missing required SWOT group ${id}`,
      });
    }
  }
});

export const StrategyReportOutputContract = z.object({
  report: StrategyReportContentContract,
}).passthrough();

const StrategyReportAdversarialReviewContract = z.object({
  verdict: StrategyReportStringSchema.max(80),
  confidence: StrategyReportOptionalStringSchema,
  findings: z.array(StrategyReportStringSchema.max(420)).max(12).default([]),
  requiredChanges: z.array(StrategyReportStringSchema.max(420)).max(12).default([]),
  required_changes: z.array(StrategyReportStringSchema.max(420)).max(12).optional(),
}).passthrough();

const STRATEGY_REPORT_STRUCTURED_OUTPUT_CONTRACT = [
  "Structured output contract (Zod source of truth): return exactly one JSON object {\"report\": StrategyReportContent}.",
  "StrategyReportContent required string fields: commandLine, diagnosisKicker, diagnosisTitle, diagnosisLead, positioningStatement, judgement, analysisBasisLabel.",
  "summaryTiles: 3-6 items, each {id,label,title,detail}; never omit this field.",
  "criteriaRows: at least 4 items, each {id,label,value}.",
  "canvasBlocks: at least 9 items covering partners, activities, resources, value-proposition, relationships, channels, customer-segments, cost-structure, revenue-streams; each has {id,title,bullets}.",
  "competitors: at least 3 items, including {id:\"agentic30\", isAgentic30:true}; every item has title, tag, body, gap, adaptiveScore, evidenceScore, sourceLabel, scoreRationale.",
  "swotGroups: exactly/at least strengths, weaknesses, opportunities, threats; each has {id,title,tag,bullets}.",
  "Optional but preferred: tone, swotMatrixColumnCount, swotMatrixRows, sourceRefs, searchableCopy, generatedBadge, canvasMeta, matrixMeta, swotMeta.",
].join("\n");

const STRATEGY_REPORT_ADVERSARIAL_OUTPUT_CONTRACT = [
  "Structured output contract (Zod source of truth): return exactly one JSON object with verdict, confidence, findings, requiredChanges.",
  "findings must contain at least one concrete critique. requiredChanges may be empty only when verdict is pass.",
].join("\n");

export function resolveStrategyReportCachePath(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "strategy", "research-report-cache.json");
}

export function resolveStrategyReportRunsDir(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "strategy", "runs");
}

export function buildStrategyReportProgressStatus(progress = {}, {
  reason = "manual",
  startedAt = null,
  researchSource = null,
  stale = false,
  nowMs = Date.now(),
} = {}) {
  const stage = cleanString(progress.stage || "checking_exa_route", 120) || "checking_exa_route";
  const step = STRATEGY_REPORT_PROGRESS_BY_STAGE.get(stage) || null;
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
      : STRATEGY_REPORT_PROGRESS_STEPS.length,
    partialFailures: normalizePartialFailures(progress.partialFailures || progress.partial_failures),
  };
}

export async function loadStrategyReportSnapshot({
  workspaceRoot,
  now = new Date(),
  fsImpl = fs,
  exaApiKey = "",
  exaConfigured = false,
  exaResearchSource = "",
} = {}) {
  const cachePath = resolveStrategyReportCachePath(workspaceRoot);
  const raw = await readJsonFile(cachePath, fsImpl);
  const configured = exaConfigured || Boolean(String(exaApiKey || "").trim());
  if (raw?.snapshot) {
    try {
      const snapshot = normalizeStrategyReportSnapshot(raw.snapshot, {
        now,
        fallbackStatus: statusForSnapshot(raw.snapshot.status, now),
      });
      if (!configured && snapshot.report) {
        return {
          ...snapshot,
          status: {
            ...snapshot.status,
            state: "stale",
            stale: true,
            error: "Exa MCP is not configured.",
            reason: "exa_mcp_missing",
            researchSource: null,
          },
        };
      }
      return snapshot;
    } catch {
      return makeEmptyStrategyReportSnapshot({
        now,
        status: "failed",
        error: "Cached strategy report is invalid.",
        reason: "cache_invalid",
        researchSource: configured ? exaResearchSource : null,
      });
    }
  }
  return makeEmptyStrategyReportSnapshot({
    now,
    status: configured ? "idle" : "failed",
    error: configured ? null : "Exa MCP is not configured.",
    reason: configured ? "not_loaded" : "exa_mcp_missing",
    researchSource: configured ? exaResearchSource : null,
  });
}

export async function refreshStrategyReport({
  workspaceRoot,
  exaApiKey = "",
  exaMcpConfig = null,
  exaResearchRoute = null,
  exaResearchRoutes = [],
  reason = "manual",
  force = false,
  providerResearcher,
  adversarialReviewer,
  multidimensionalVerifier,
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
  notifyStrategyReportProgress(onProgress, {
    stage: "checking_exa_route",
    researchSource: primaryRoute?.label || null,
  });
  const previous = await loadStrategyReportSnapshot({
    workspaceRoot,
    now,
    fsImpl,
    exaApiKey: key,
    exaConfigured: routes.length > 0,
    exaResearchSource: primaryRoute?.label || null,
  });
  if (routes.length === 0) {
    return persistStrategyReportSnapshot({
      workspaceRoot,
      snapshot: makeStrategyReportFailureSnapshot({
        previous,
        now,
        reason: "exa_mcp_missing",
        error: "Exa MCP is not configured.",
        researchSource: null,
      }),
      now,
    });
  }

  notifyStrategyReportProgress(onProgress, {
    stage: "loading_strategy_context",
    researchSource: primaryRoute?.label || null,
  });
  const context = await buildStrategyReportResearchContext({
    workspaceRoot,
    now,
    fsImpl,
  });
  const contextFingerprint = fingerprintStrategyReportContext(context);
  if (!force && previous.status?.state === "ready" && previous.generatedAt) {
    const ageMs = now.getTime() - Date.parse(previous.generatedAt);
    if (
      previous.contextFingerprint === contextFingerprint
      && Number.isFinite(ageMs)
      && ageMs < STRATEGY_REPORT_REFRESH_INTERVAL_MS
    ) {
      return previous;
    }
  }

  const startedAt = now.toISOString();
  try {
    if (typeof providerResearcher !== "function") {
      throw new Error("strategy report requires a providerResearcher.");
    }
    if (typeof adversarialReviewer !== "function") {
      throw new Error("strategy report requires an adversarialReviewer.");
    }
    if (typeof multidimensionalVerifier !== "function") {
      throw new Error("strategy report requires a multidimensionalVerifier.");
    }

    notifyStrategyReportProgress(onProgress, {
      stage: "running_exa_research",
      researchSource: primaryRoute?.label || null,
    });
    const researchResult = await providerResearcher({
      context,
      prompt: buildStrategyReportResearchPrompt(context),
      exaMcpConfig: primaryRoute.mcpConfig,
      exaResearchRoute: summarizeExaResearchRoute(primaryRoute),
      exaResearchRoutes: routes,
      exaApiKeyConfigured: Boolean(key),
      reason,
      mode: "exa_research",
      onProgress: (progress = {}) => notifyStrategyReportProgress(onProgress, {
        ...progress,
        stage: "running_exa_research",
        researchSource: progress.researchSource || primaryRoute?.label || null,
      }),
    });
    const candidateReport = extractStrategyReport(researchResult, { now });

    notifyStrategyReportProgress(onProgress, {
      stage: "running_adversarial_review",
      researchSource: primaryRoute?.label || null,
    });
    const adversarialResult = await adversarialReviewer({
      context,
      candidateReport,
      prompt: buildStrategyReportAdversarialPrompt({
        context,
        candidateReport,
      }),
      reason,
      researchSource: rawProviderResultResearchSource(researchResult) || primaryRoute.label || null,
      mode: "adversarial_review",
    });
    const adversarialReview = normalizeAdversarialReview(
      parseStrategyReportContract(
        StrategyReportAdversarialReviewContract,
        extractProviderJson(adversarialResult),
        "strategy report adversarial review",
      ),
    );

    notifyStrategyReportProgress(onProgress, {
      stage: "running_multidimensional_review",
      researchSource: primaryRoute?.label || null,
    });
    const finalResult = await multidimensionalVerifier({
      context,
      candidateReport,
      adversarialReview,
      prompt: buildStrategyReportVerificationPrompt({
        context,
        candidateReport,
        adversarialReview,
      }),
      reason,
      researchSource: rawProviderResultResearchSource(researchResult) || primaryRoute.label || null,
      mode: "multidimensional_verification",
    });
    const finalReport = extractStrategyReport(finalResult, { now });

    notifyStrategyReportProgress(onProgress, {
      stage: "saving_results",
      researchSource: rawProviderResultResearchSource(finalResult)
        || rawProviderResultResearchSource(researchResult)
        || primaryRoute.label
        || null,
    });
    const completedAt = new Date().toISOString();
    const researchSource = cleanString(
      rawProviderResultResearchSource(finalResult)
        || rawProviderResultResearchSource(researchResult)
        || primaryRoute.label
        || "",
      160,
    ) || null;
    return persistStrategyReportSnapshot({
      workspaceRoot,
      snapshot: {
        schemaVersion: STRATEGY_REPORT_SCHEMA_VERSION,
        promptProfile: STRATEGY_REPORT_PROMPT_PROFILE,
        contentLocale: STRATEGY_REPORT_CONTENT_LOCALE,
        generatedAt: now.toISOString(),
        nextRefreshAfter: new Date(now.getTime() + STRATEGY_REPORT_REFRESH_INTERVAL_MS).toISOString(),
        contextFingerprint,
        status: {
          state: "ready",
          lastSuccessAt: now.toISOString(),
          stale: false,
          error: null,
          reason,
          researchSource,
          stage: "saving_results",
          progressText: null,
          elapsedMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
          stepIndex: STRATEGY_REPORT_PROGRESS_STEPS.length,
          stepCount: STRATEGY_REPORT_PROGRESS_STEPS.length,
          partialFailures: [],
          startedAt,
          completedAt,
          durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
        },
        workspaceEvidenceRefs: context.evidence.map(evidenceToSourceRef),
        report: finalReport,
      },
      rawProviderResult: summarizeProviderPasses({
        researchResult,
        adversarialResult,
        finalResult,
      }),
      now,
    });
  } catch (error) {
    return persistStrategyReportSnapshot({
      workspaceRoot,
      snapshot: makeStrategyReportFailureSnapshot({
        previous,
        now,
        reason,
        error,
        researchSource: primaryRoute?.label || null,
        contextFingerprint,
        startedAt,
      }),
      rawProviderResult: {
        mode: "three_pass_strategy_report_failed",
        error: formatStrategyReportError(error),
      },
      now,
    });
  }
}

export function normalizeStrategyReportSnapshot(value = {}, {
  now = new Date(),
  fallbackStatus = null,
} = {}) {
  const report = value.report
    ? normalizeStrategyReport(value.report, { now })
    : null;
  const status = normalizeStrategyReportStatus(value.status || fallbackStatus, {
    now,
    hasReport: Boolean(report),
  });
  return {
    schemaVersion: clampInt(value.schemaVersion ?? value.schema_version, 1, 10, STRATEGY_REPORT_SCHEMA_VERSION),
    promptProfile: cleanString(value.promptProfile || value.prompt_profile || STRATEGY_REPORT_PROMPT_PROFILE, 160)
      || STRATEGY_REPORT_PROMPT_PROFILE,
    contentLocale: cleanString(value.contentLocale || value.content_locale || STRATEGY_REPORT_CONTENT_LOCALE, 40)
      || STRATEGY_REPORT_CONTENT_LOCALE,
    generatedAt: normalizeIsoDate(value.generatedAt || value.generated_at),
    nextRefreshAfter: normalizeIsoDate(value.nextRefreshAfter || value.next_refresh_after),
    contextFingerprint: cleanString(value.contextFingerprint || value.context_fingerprint || "", 160) || null,
    status,
    workspaceEvidenceRefs: normalizeSourceRefs(value.workspaceEvidenceRefs || value.workspace_evidence_refs),
    report,
  };
}

export function makeEmptyStrategyReportSnapshot({
  now = new Date(),
  status = "idle",
  error = null,
  reason = null,
  researchSource = null,
} = {}) {
  return normalizeStrategyReportSnapshot({
    schemaVersion: STRATEGY_REPORT_SCHEMA_VERSION,
    promptProfile: STRATEGY_REPORT_PROMPT_PROFILE,
    contentLocale: STRATEGY_REPORT_CONTENT_LOCALE,
    generatedAt: null,
    nextRefreshAfter: null,
    contextFingerprint: null,
    status: {
      state: status,
      lastSuccessAt: null,
      stale: false,
      error,
      reason,
      researchSource,
      partialFailures: [],
    },
    workspaceEvidenceRefs: [],
    report: null,
  }, { now });
}

export async function buildStrategyReportResearchContext({
  workspaceRoot,
  now = new Date(),
  fsImpl = fs,
} = {}) {
  const root = path.resolve(String(workspaceRoot || "."));
  const evidence = [];
  const seenPaths = new Set();
  for (const candidate of STRATEGY_EVIDENCE_CANDIDATES) {
    const relativePath = normalizeSafeRelativePath(candidate.relativePath);
    if (!relativePath || seenPaths.has(relativePath) || isDeniedRelativePath(relativePath)) continue;
    seenPaths.add(relativePath);
    try {
      const absolutePath = path.join(root, relativePath);
      const raw = await fsImpl.readFile(absolutePath, "utf8");
      const excerpt = cleanString(redactSensitiveString(raw), MAX_EVIDENCE_CHARS_PER_DOC);
      if (!excerpt) continue;
      evidence.push({
        id: stableHash(`${candidate.role}:${relativePath}`),
        sourceType: "workspace",
        role: candidate.role,
        path: relativePath,
        title: candidate.title || path.basename(relativePath),
        excerpt,
        charsRead: raw.length,
        truncated: raw.length > MAX_EVIDENCE_CHARS_PER_DOC,
      });
    } catch {
      // Missing strategy docs are acceptable in early workspaces.
    }
  }
  return {
    productName: "Agentic30",
    generatedAt: now.toISOString(),
    locale: STRATEGY_REPORT_CONTENT_LOCALE,
    promptProfile: STRATEGY_REPORT_PROMPT_PROFILE,
    evidence,
    requiredSections: [
      "diagnosis",
      "analysis criteria",
      "9-block business canvas",
      "competitor matrix",
      "SWOT",
      "strategy judgement",
      "positioning statement",
    ],
  };
}

function buildStrategyReportResearchPrompt(context) {
  return truncatePrompt([
    "Exa public research pass for Agentic30 strategy report.",
    "Use Exa MCP public search/fetch tools to update the strategy report with current public evidence.",
    "Return only valid JSON. All user-facing prose must be Korean.",
    "Do not store or output raw private alignment, transcript, BIP records, tokens, emails, or credentials. Public-safe summaries only.",
    `Prompt profile: ${STRATEGY_REPORT_PROMPT_PROFILE}`,
    STRATEGY_REPORT_STRUCTURED_OUTPUT_CONTRACT,
    "Score every competitor against Adaptive local context and PMF evidence, not coding speed alone.",
    `Context: ${JSON.stringify(context)}`,
  ].join("\n\n"));
}

function buildStrategyReportAdversarialPrompt({
  context,
  candidateReport,
} = {}) {
  return truncatePrompt([
    "Adversarial strategy review for Agentic30.",
    "Attack the candidate report for unsupported claims, missing competitors, weak ICP logic, and gaps against public evidence.",
    "Do not browse or use tools in this pass. Work only from the candidate report and embedded context.",
    "Return only valid JSON.",
    STRATEGY_REPORT_ADVERSARIAL_OUTPUT_CONTRACT,
    `Context: ${JSON.stringify(context)}`,
    `Candidate report: ${JSON.stringify(candidateReport)}`,
  ].join("\n\n"));
}

function buildStrategyReportVerificationPrompt({
  context,
  candidateReport,
  adversarialReview,
} = {}) {
  return truncatePrompt([
    "Multidimensional final verification for Agentic30 strategy report.",
    "Revise the candidate into final static-equivalent quality across diagnosis, criteria, 9-block canvas, matrix, SWOT, judgement, and positioning.",
    "Check these dimensions: ICP fit, business model coherence, competitive positioning, public evidence strength, privacy safety, and launch sequence.",
    "Return only valid JSON. All user-facing prose must be Korean.",
    STRATEGY_REPORT_STRUCTURED_OUTPUT_CONTRACT,
    "Do not include raw private alignment, transcript, BIP records, tokens, emails, or credentials.",
    `Context: ${JSON.stringify(context)}`,
    `Candidate report: ${JSON.stringify(candidateReport)}`,
    `Adversarial review: ${JSON.stringify(adversarialReview)}`,
  ].join("\n\n"));
}

async function persistStrategyReportSnapshot({
  workspaceRoot,
  snapshot,
  rawProviderResult = null,
  now = new Date(),
} = {}) {
  const cachePath = resolveStrategyReportCachePath(workspaceRoot);
  const runsDir = resolveStrategyReportRunsDir(workspaceRoot);
  const normalized = normalizeStrategyReportSnapshot(deepSanitize(snapshot), { now });
  await atomicWriteJson(cachePath, {
    schemaVersion: STRATEGY_REPORT_CACHE_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    snapshot: normalized,
  });
  await fs.mkdir(runsDir, { recursive: true });
  await atomicWriteJson(path.join(runsDir, `${safeTimestamp(now)}.json`), {
    schemaVersion: STRATEGY_REPORT_CACHE_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    snapshot: normalized,
    rawProviderResult: deepSanitize(rawProviderResult),
  });
  await pruneStrategyReportRuns({ workspaceRoot, now });
  return normalized;
}

async function pruneStrategyReportRuns({
  workspaceRoot,
  now = new Date(),
  fsImpl = fs,
} = {}) {
  const runsDir = resolveStrategyReportRunsDir(workspaceRoot);
  let entries = [];
  try {
    entries = await fsImpl.readdir(runsDir, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoff = now.getTime() - STRATEGY_REPORT_RETENTION_DAYS * DAY_MS;
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".json")) return;
    const filePath = path.join(runsDir, entry.name);
    try {
      const stat = await fsImpl.stat(filePath);
      if (stat.mtimeMs < cutoff) await fsImpl.rm(filePath, { force: true });
    } catch {
      // Ignore racing deletes.
    }
  }));
}

function makeStrategyReportFailureSnapshot({
  previous = null,
  now = new Date(),
  reason = "manual",
  error = null,
  researchSource = null,
  contextFingerprint = null,
  startedAt = null,
} = {}) {
  const hasPreviousReport = Boolean(previous?.report);
  const completedAt = new Date().toISOString();
  return {
    ...(hasPreviousReport ? previous : makeEmptyStrategyReportSnapshot({ now })),
    contextFingerprint: contextFingerprint || previous?.contextFingerprint || null,
    status: {
      state: "failed",
      lastSuccessAt: previous?.status?.lastSuccessAt || previous?.generatedAt || null,
      stale: hasPreviousReport,
      error: formatStrategyReportError(error),
      reason,
      researchSource: cleanString(researchSource || previous?.status?.researchSource || "", 160) || null,
      completedAt,
      startedAt: normalizeIsoDate(startedAt),
      durationMs: startedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) : null,
      partialFailures: [],
    },
  };
}

function extractStrategyReport(rawProviderResult, { now = new Date() } = {}) {
  const parsed = extractProviderJson(rawProviderResult);
  const report = parsed?.report || parsed?.strategyReport || parsed?.strategy_report || parsed;
  parseStrategyReportContract(
    StrategyReportContentContract,
    report,
    "strategy report structured output",
  );
  return normalizeStrategyReport(report, { now });
}

function parseStrategyReportContract(schema, value, label) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error(`${label} contract violation: ${zodIssueSummary(parsed.error)}`);
}

function normalizeStrategyReport(value = {}, { now = new Date() } = {}) {
  if (!value || typeof value !== "object") {
    throw new Error("strategy report missing report object");
  }
  const sanitized = deepSanitize(value);
  const report = {
    commandLine: cleanString(sanitized.commandLine || sanitized.command_line, 240),
    diagnosisKicker: cleanString(sanitized.diagnosisKicker || sanitized.diagnosis_kicker, 80),
    diagnosisTitle: cleanString(sanitized.diagnosisTitle || sanitized.diagnosis_title, 360),
    diagnosisLead: cleanString(sanitized.diagnosisLead || sanitized.diagnosis_lead, 800),
    positioningStatement: cleanString(sanitized.positioningStatement || sanitized.positioning_statement, 500),
    judgement: cleanString(sanitized.judgement || sanitized.strategyJudgement || sanitized.strategy_judgement, 900),
    generatedBadge: cleanString(sanitized.generatedBadge || sanitized.generated_badge || "동적 리서치", 80),
    analysisBasisLabel: cleanString(sanitized.analysisBasisLabel || sanitized.analysis_basis_label || "SPEC.md + ICP.md + VALUES.md + Exa", 160),
    canvasMeta: cleanString(sanitized.canvasMeta || sanitized.canvas_meta || "9 blocks · dynamic report", 120),
    matrixMeta: cleanString(sanitized.matrixMeta || sanitized.matrix_meta || "positioning · Exa verified", 120),
    swotMeta: cleanString(sanitized.swotMeta || sanitized.swot_meta || "internal / external · verified", 120),
    summaryTiles: normalizeSummaryTiles(sanitized.summaryTiles || sanitized.summary_tiles),
    criteriaRows: normalizeCriteriaRows(sanitized.criteriaRows || sanitized.criteria_rows),
    canvasBlocks: normalizeCanvasBlocks(sanitized.canvasBlocks || sanitized.canvas_blocks),
    competitors: normalizeCompetitors(sanitized.competitors || sanitized.competitorMatrix || sanitized.competitor_matrix),
    swotGroups: normalizeSwotGroups(sanitized.swotGroups || sanitized.swot_groups),
    swotMatrixColumnCount: clampInt(
      sanitized.swotMatrixColumnCount ?? sanitized.swot_matrix_column_count,
      1,
      4,
      2,
    ),
    swotMatrixRows: normalizeSwotMatrixRows(sanitized.swotMatrixRows || sanitized.swot_matrix_rows),
    sourceRefs: normalizeSourceRefs(sanitized.sourceRefs || sanitized.source_refs),
    searchableCopy: normalizeStringArray(sanitized.searchableCopy || sanitized.searchable_copy, 80, 500),
    generatedAt: normalizeIsoDate(sanitized.generatedAt || sanitized.generated_at) || now.toISOString(),
  };
  validateStrategyReport(report);
  return {
    ...report,
    businessCanvasTopRows: normalizeCanvasRows(
      sanitized.businessCanvasTopRows || sanitized.business_canvas_top_rows,
      [["partners"], ["activities", "resources"], ["value-proposition"], ["relationships", "channels"], ["customer-segments"]],
    ),
    businessCanvasBottomRow: normalizeStringArray(
      sanitized.businessCanvasBottomRow || sanitized.business_canvas_bottom_row,
      10,
      80,
    ).length > 0
      ? normalizeStringArray(sanitized.businessCanvasBottomRow || sanitized.business_canvas_bottom_row, 10, 80)
      : ["cost-structure", "revenue-streams"],
  };
}

function validateStrategyReport(report) {
  for (const key of [
    "commandLine",
    "diagnosisKicker",
    "diagnosisTitle",
    "diagnosisLead",
    "positioningStatement",
    "judgement",
  ]) {
    if (!report[key]) throw new Error(`strategy report missing required ${key}`);
  }
  if (report.summaryTiles.length < 3) throw new Error("strategy report missing required summaryTiles");
  if (report.criteriaRows.length < 4) throw new Error("strategy report missing required criteriaRows");
  const blockIds = new Set(report.canvasBlocks.map((block) => block.id));
  const missingBlocks = REQUIRED_CANVAS_BLOCK_IDS.filter((id) => !blockIds.has(id));
  if (missingBlocks.length > 0) {
    throw new Error(`strategy report missing required canvasBlocks: ${missingBlocks.join(", ")}`);
  }
  if (report.competitors.length < 3) throw new Error("strategy report missing required competitors");
  if (!report.competitors.some((competitor) => competitor.id === "agentic30" && competitor.isAgentic30)) {
    throw new Error("strategy report missing required Agentic30 competitor");
  }
  const swotIds = new Set(report.swotGroups.map((group) => group.id));
  const missingSwot = REQUIRED_SWOT_GROUP_IDS.filter((id) => !swotIds.has(id));
  if (missingSwot.length > 0) {
    throw new Error(`strategy report missing required swotGroups: ${missingSwot.join(", ")}`);
  }
}

function normalizeSummaryTiles(value) {
  return asArray(value).map((tile, index) => ({
    id: slugify(tile?.id || tile?.label || `summary-${index + 1}`),
    label: cleanString(tile?.label, 80),
    title: cleanString(tile?.title, 160),
    detail: cleanString(tile?.detail || tile?.body, 360),
  })).filter((tile) => tile.id && tile.label && tile.title && tile.detail).slice(0, 6);
}

function normalizeCriteriaRows(value) {
  return asArray(value).map((row, index) => ({
    id: slugify(row?.id || row?.label || `criteria-${index + 1}`),
    label: cleanString(row?.label, 80),
    value: cleanString(row?.value || row?.detail, 500),
  })).filter((row) => row.id && row.label && row.value).slice(0, 12);
}

function normalizeCanvasBlocks(value) {
  return asArray(value).map((block, index) => ({
    id: slugify(block?.id || block?.title || `block-${index + 1}`),
    number: cleanString(block?.number || String(index + 1).padStart(2, "0"), 8),
    eyebrow: cleanString(block?.eyebrow || block?.label, 80),
    title: cleanString(block?.title, 120),
    bullets: normalizeStringArray(block?.bullets || block?.items, 8, 280),
    tone: normalizeTone(block?.tone),
  })).filter((block) => block.id && block.title && block.bullets.length > 0).slice(0, 12);
}

function normalizeCompetitors(value) {
  return asArray(value).map((competitor, index) => {
    const title = cleanString(competitor?.title || competitor?.name, 120);
    const id = slugify(competitor?.id || title || `competitor-${index + 1}`);
    return {
      id,
      title,
      tag: cleanString(competitor?.tag || competitor?.subtitle, 180),
      body: cleanString(competitor?.body || competitor?.description, 600),
      gap: cleanString(competitor?.gap || competitor?.strategicGap || competitor?.strategic_gap, 420),
      x: clampNumber(competitor?.x, 0.02, 0.98, 0.5),
      y: clampNumber(competitor?.y, 0.02, 0.98, 0.5),
      adaptiveScore: clampInt(competitor?.adaptiveScore ?? competitor?.adaptive_score, 0, 100, 0),
      evidenceScore: clampInt(competitor?.evidenceScore ?? competitor?.evidence_score, 0, 100, 0),
      sourceLabel: cleanString(competitor?.sourceLabel || competitor?.source_label, 160),
      sourceURL: cleanString(competitor?.sourceURL || competitor?.sourceUrl || competitor?.source_url, 500),
      sourceDisplay: cleanString(competitor?.sourceDisplay || competitor?.source_display, 160),
      verifiedAt: cleanString(competitor?.verifiedAt || competitor?.verified_at, 80),
      scoreRationale: cleanString(competitor?.scoreRationale || competitor?.score_rationale, 500),
      category: normalizeCompetitorCategory(competitor?.category, Boolean(competitor?.isAgentic30 || competitor?.is_agentic30)),
      isAgentic30: Boolean(competitor?.isAgentic30 || competitor?.is_agentic30 || id === "agentic30"),
      labelPlacement: normalizeLabelPlacement(competitor?.labelPlacement || competitor?.label_placement),
    };
  }).filter((competitor) => (
    competitor.id
    && competitor.title
    && competitor.tag
    && competitor.body
    && competitor.sourceLabel
    && competitor.scoreRationale
  )).slice(0, 12);
}

function normalizeSwotGroups(value) {
  return asArray(value).map((group, index) => ({
    id: slugify(group?.id || group?.title || `swot-${index + 1}`),
    title: cleanString(group?.title, 120),
    tag: cleanString(group?.tag || group?.label, 80),
    tone: normalizeTone(group?.tone),
    bullets: normalizeStringArray(group?.bullets || group?.items, 8, 300),
  })).filter((group) => group.id && group.title && group.tag && group.bullets.length > 0).slice(0, 8);
}

function normalizeSourceRefs(value) {
  return asArray(value).map((source, index) => {
    const url = cleanString(source?.url, 500) || null;
    const pathValue = cleanString(source?.path, 500) || null;
    const title = cleanString(source?.title || source?.name || url || pathValue || `source-${index + 1}`, 220);
    return {
      id: cleanString(source?.id, 120) || stableHash(`${title}:${url || pathValue || index}`),
      sourceType: cleanString(source?.sourceType || source?.source_type || "public_web", 80) || "public_web",
      title,
      url,
      domain: cleanString(source?.domain || domainFromUrl(url), 160) || null,
      path: pathValue,
      publishedAt: cleanString(source?.publishedAt || source?.published_at, 80) || null,
      excerpt: cleanString(source?.excerpt || source?.summary, 500) || null,
    };
  }).filter((source) => source.title && (source.url || source.path || source.excerpt)).slice(0, 24);
}

function normalizeSwotMatrixRows(value) {
  const rows = asArray(value)
    .map((row) => normalizeStringArray(row, 4, 80))
    .filter((row) => row.length > 0)
    .slice(0, 4);
  return rows.length > 0
    ? rows
    : [["strengths", "weaknesses"], ["opportunities", "threats"]];
}

function normalizeCanvasRows(value, fallback) {
  const rows = asArray(value)
    .map((row) => normalizeStringArray(row, 6, 80))
    .filter((row) => row.length > 0)
    .slice(0, 6);
  return rows.length > 0 ? rows : fallback;
}

function normalizeAdversarialReview(value = {}) {
  const normalized = deepSanitize(value || {});
  return {
    verdict: cleanString(normalized.verdict || "needs_review", 80),
    confidence: cleanString(normalized.confidence, 80) || null,
    findings: normalizeStringArray(normalized.findings, 12, 420),
    requiredChanges: normalizeStringArray(normalized.requiredChanges || normalized.required_changes, 12, 420),
  };
}

function normalizeStrategyReportStatus(value = {}, { hasReport = false } = {}) {
  const rawState = cleanString(value?.state, 80) || (hasReport ? "ready" : "idle");
  const state = ["idle", "refreshing", "ready", "stale", "failed"].includes(rawState)
    ? rawState
    : hasReport ? "ready" : "idle";
  return {
    state,
    lastSuccessAt: normalizeIsoDate(value?.lastSuccessAt || value?.last_success_at),
    stale: Boolean(value?.stale ?? (state === "stale")),
    error: cleanString(value?.error, 500) || null,
    reason: cleanString(value?.reason, 120) || null,
    researchSource: cleanString(value?.researchSource || value?.research_source, 160) || null,
    stage: cleanString(value?.stage, 120) || null,
    progressText: cleanString(value?.progressText || value?.progress_text, 240) || null,
    elapsedMs: Number.isFinite(value?.elapsedMs) ? Math.max(0, Math.round(value.elapsedMs)) : null,
    stepIndex: Number.isFinite(value?.stepIndex) ? value.stepIndex : null,
    stepCount: Number.isFinite(value?.stepCount) ? value.stepCount : null,
    partialFailures: normalizePartialFailures(value?.partialFailures || value?.partial_failures),
    startedAt: normalizeIsoDate(value?.startedAt || value?.started_at),
    completedAt: normalizeIsoDate(value?.completedAt || value?.completed_at),
    durationMs: Number.isFinite(value?.durationMs) ? Math.max(0, Math.round(value.durationMs)) : null,
  };
}

function statusForSnapshot(value = {}) {
  if (value && typeof value === "object") return value;
  return {
    state: "idle",
    stale: false,
    error: null,
    partialFailures: [],
  };
}

function normalizePartialFailures(value) {
  return asArray(value).map((failure, index) => ({
    laneId: cleanString(failure?.laneId || failure?.lane_id || failure?.id || `pass-${index + 1}`, 80),
    laneTitle: cleanString(failure?.laneTitle || failure?.lane_title || failure?.title || "Strategy pass", 120),
    error: cleanString(failure?.error || failure?.message, 300),
  })).filter((failure) => failure.laneId && failure.error).slice(0, 8);
}

function normalizeExaResearchRoutes({
  exaApiKey = "",
  exaMcpConfig = null,
  exaResearchRoute = null,
  exaResearchRoutes = [],
} = {}) {
  const routes = [
    ...asArray(exaResearchRoutes),
    exaResearchRoute,
  ].filter(Boolean).map((route, index) => normalizeExaResearchRoute(route, index)).filter(Boolean);
  if (routes.length > 0) return routes;
  const key = String(exaApiKey || "").trim();
  const config = exaMcpConfig || (key ? buildExaMcpConfig(key) : null);
  if (!config) return [];
  return [normalizeExaResearchRoute({
    provider: "",
    label: "Exa MCP",
    mcpConfig: config,
  }, 0)].filter(Boolean);
}

function normalizeExaResearchRoute(route, index = 0) {
  const mcpConfig = route?.mcpConfig || route?.mcp_config || route?.config || null;
  if (!mcpConfig) return null;
  return {
    provider: cleanString(route.provider, 80) || null,
    label: cleanString(route.label || route.name || `Exa MCP ${index + 1}`, 160) || `Exa MCP ${index + 1}`,
    mcpConfig,
  };
}

function buildExaMcpConfig(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) return null;
  return {
    type: "http",
    url: "https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa,web_fetch_exa",
    headers: { "x-api-key": key },
  };
}

function summarizeExaResearchRoute(route = {}) {
  return {
    provider: route.provider || null,
    label: route.label || null,
  };
}

function evidenceToSourceRef(evidence) {
  return {
    id: evidence.id || stableHash(evidence.path || evidence.title || ""),
    sourceType: evidence.sourceType || "workspace",
    title: evidence.title || evidence.path || "workspace evidence",
    url: null,
    domain: null,
    path: evidence.path || null,
    publishedAt: null,
    excerpt: cleanString(evidence.excerpt, 500) || null,
  };
}

function summarizeProviderPasses({
  researchResult = null,
  adversarialResult = null,
  finalResult = null,
} = {}) {
  return {
    mode: "three_pass_strategy_report",
    passes: [
      summarizeProviderResult("exa_research", researchResult),
      summarizeProviderResult("adversarial_review", adversarialResult),
      summarizeProviderResult("multidimensional_verification", finalResult),
    ],
  };
}

function summarizeProviderResult(mode, result) {
  return {
    mode,
    provider: cleanString(result?.provider, 80) || null,
    model: cleanString(result?.model, 160) || null,
    researchSource: rawProviderResultResearchSource(result),
    textChars: String(result?.text || "").length,
  };
}

function rawProviderResultResearchSource(result) {
  return cleanString(
    result?.researchSource
      || result?.research_source
      || result?.provider
      || "",
    160,
  ) || null;
}

function extractProviderJson(rawProviderResult) {
  if (!rawProviderResult) throw new Error("strategy report provider returned no result");
  if (typeof rawProviderResult === "object" && !("text" in rawProviderResult)) {
    return rawProviderResult;
  }
  const text = typeof rawProviderResult === "string"
    ? rawProviderResult
    : String(rawProviderResult.text || "");
  const trimmed = text.trim();
  if (!trimmed) throw new Error("strategy report provider returned empty text");
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonText = extractJsonObject(trimmed);
    if (!jsonText) throw new Error("strategy report provider did not return valid JSON");
    return JSON.parse(jsonText);
  }
}

function zodIssueSummary(error) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

function extractJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function fingerprintStrategyReportContext(context) {
  return createHash("sha256")
    .update(JSON.stringify(context))
    .digest("hex");
}

function resolveAgentic30Dir(workspaceRoot) {
  return path.join(path.resolve(String(workspaceRoot || ".")), ".agentic30");
}

async function readJsonFile(filePath, fsImpl = fs) {
  try {
    const raw = await fsImpl.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function notifyStrategyReportProgress(onProgress, progress) {
  if (typeof onProgress !== "function") return;
  onProgress({
    ...progress,
    stepCount: STRATEGY_REPORT_PROGRESS_STEPS.length,
  });
}

function deepSanitize(value) {
  if (typeof value === "string") return redactSensitiveString(value);
  if (Array.isArray(value)) return value.map(deepSanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, deepSanitize(inner)]));
  }
  return value;
}

function redactSensitiveString(value) {
  let text = String(value || "");
  if (!text) return "";
  if (PRIVATE_RAW_TEXT_PATTERN.test(text)) {
    return "[redacted-private]";
  }
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    text = text.replace(pattern, "[redacted-private]");
  }
  return text;
}

function cleanString(value, maxLength = 400) {
  const text = redactSensitiveString(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
}

function normalizeStringArray(value, maxItems = 8, maxLength = 240) {
  return asArray(value)
    .map((item) => cleanString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTone(value) {
  const tone = cleanString(value, 40);
  return ["accent", "blue", "sky", "magenta"].includes(tone) ? tone : "accent";
}

function normalizeCompetitorCategory(value, isAgentic30 = false) {
  if (isAgentic30) return "agentic30";
  const category = cleanString(value, 80);
  return ["agentic30", "aiBuild", "community", "education", "generic", "other"].includes(category)
    ? category
    : "other";
}

function normalizeLabelPlacement(value) {
  const placement = cleanString(value, 40);
  return ["leading", "trailing", "above", "below"].includes(placement) ? placement : "leading";
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeIsoDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function stableHash(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 16);
}

function normalizeSafeRelativePath(value) {
  const raw = String(value || "").replace(/\\/g, "/").trim();
  if (!raw || raw.startsWith("/") || raw.includes("\0")) return "";
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === "..") return "";
  return normalized;
}

function isDeniedRelativePath(relativePath) {
  return relativePath.split("/").some((segment) => DENIED_PATH_SEGMENTS.has(segment));
}

function domainFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function truncatePrompt(prompt) {
  if (prompt.length <= MAX_PROVIDER_PROMPT_CHARS) return prompt;
  return `${prompt.slice(0, MAX_PROVIDER_PROMPT_CHARS - 120)}\n\n[truncated for provider prompt budget]`;
}

function formatStrategyReportError(error) {
  return cleanString(error?.message || error || "Strategy report refresh failed.", 500)
    || "Strategy report refresh failed.";
}

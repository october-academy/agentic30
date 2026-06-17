import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { atomicWriteJson } from "./atomic-store.mjs";
import {
  createDirectExaApiKeyRequiredError,
  DIRECT_EXA_API_KEY_REQUIRED_REASON,
  DIRECT_EXA_SEARCH_FAILED_REASON,
  extractDirectExaApiKey,
} from "./direct-exa-research.mjs";
import { projectDocDefinitions } from "./project-doc-paths.mjs";

export const STRATEGY_REPORT_SCHEMA_VERSION = 1;
export const STRATEGY_REPORT_CACHE_SCHEMA_VERSION = 1;
export const STRATEGY_REPORT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const STRATEGY_REPORT_RETENTION_DAYS = 30;
export const STRATEGY_REPORT_CONTENT_LOCALE = "ko-KR";
export const STRATEGY_REPORT_PROMPT_PROFILE = "ko_strategy_report_v1_three_pass_exa";
export const STRATEGY_REPORT_OUTPUT_SCHEMA_NAME = "StrategyReportOutputContract";
export const STRATEGY_REPORT_ADVERSARIAL_OUTPUT_SCHEMA_NAME = "StrategyReportAdversarialReviewContract";
export const STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS = Object.freeze({
  competitorsMinItems: 3,
  competitorsMaxItems: 12,
});
export const STRATEGY_REPORT_STRUCTURED_OUTPUT_FAILURE_PROVIDER_SCHEMA_INVALID_LOCAL = "provider_schema_invalid_local";

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
const CANVAS_BLOCK_ID_BY_NUMBER = new Map([
  ["1", "customer-segments"],
  ["01", "customer-segments"],
  ["2", "value-proposition"],
  ["02", "value-proposition"],
  ["3", "channels"],
  ["03", "channels"],
  ["4", "relationships"],
  ["04", "relationships"],
  ["5", "revenue-streams"],
  ["05", "revenue-streams"],
  ["6", "resources"],
  ["06", "resources"],
  ["7", "activities"],
  ["07", "activities"],
  ["8", "partners"],
  ["08", "partners"],
  ["9", "cost-structure"],
  ["09", "cost-structure"],
]);
const CANVAS_BLOCK_ALIAS_BY_KEY = new Map([
  ["partners", [
    "partners",
    "partner",
    "key-partners",
    "key-partner",
    "partnerships",
    "핵심-파트너",
    "핵심파트너",
    "파트너",
    "파트너십",
  ]],
  ["activities", [
    "activities",
    "activity",
    "key-activities",
    "key-activity",
    "핵심-활동",
    "핵심활동",
    "활동",
  ]],
  ["resources", [
    "resources",
    "resource",
    "key-resources",
    "key-resource",
    "핵심-자원",
    "핵심자원",
    "자원",
  ]],
  ["value-proposition", [
    "value-proposition",
    "value-propositions",
    "value-prop",
    "value-props",
    "value",
    "uvp",
    "가치-제안",
    "가치제안",
    "가치",
  ]],
  ["relationships", [
    "relationships",
    "relationship",
    "customer-relationships",
    "customer-relationship",
    "고객-관계",
    "고객관계",
    "관계",
  ]],
  ["channels", [
    "channels",
    "channel",
    "go-to-market",
    "gtm",
    "유통-채널",
    "채널",
  ]],
  ["customer-segments", [
    "customer-segments",
    "customer-segment",
    "customers",
    "segments",
    "audience",
    "icp",
    "고객-세그먼트",
    "고객세그먼트",
    "고객-군",
    "고객군",
    "고객",
  ]],
  ["cost-structure", [
    "cost-structure",
    "cost-structures",
    "cost",
    "costs",
    "비용-구조",
    "비용구조",
    "비용",
  ]],
  ["revenue-streams", [
    "revenue-streams",
    "revenue-stream",
    "revenue",
    "revenues",
    "pricing",
    "monetization",
    "수익원",
    "수익-원",
    "수익-흐름",
    "수익흐름",
    "수익",
    "매출",
    "과금",
  ]],
].flatMap(([canonicalId, aliases]) => (
  aliases.map((alias) => [normalizeCanvasAliasKey(alias), canonicalId])
)));
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
const PRIVATE_RAW_TEXT_PATTERN_EXCEPT_API_KEY = /(raw\s+private|private\s+alignment|interview\s+transcript|transcript\s+says|token\s+sk-|password|credential)/i;

const StrategyReportStringSchema = z.string().trim().min(1);
const StrategyReportOptionalStringSchema = z.string().trim().optional();
const StrategyReportToneSchema = z.string().trim().max(40).optional();
const StrategyReportSearchableCopySchema = z.union([
  z.array(z.string()),
  z.string(),
]).optional();
const StrategyReportOptionalGeneratedFieldSchema = z.any().optional();

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
  id: StrategyReportOptionalGeneratedFieldSchema,
  blockId: StrategyReportOptionalGeneratedFieldSchema,
  block_id: StrategyReportOptionalGeneratedFieldSchema,
  canvasBlockId: StrategyReportOptionalGeneratedFieldSchema,
  canvas_block_id: StrategyReportOptionalGeneratedFieldSchema,
  key: StrategyReportOptionalGeneratedFieldSchema,
  slug: StrategyReportOptionalGeneratedFieldSchema,
  number: StrategyReportOptionalGeneratedFieldSchema,
  order: StrategyReportOptionalGeneratedFieldSchema,
  index: StrategyReportOptionalGeneratedFieldSchema,
  eyebrow: StrategyReportOptionalGeneratedFieldSchema,
  label: StrategyReportOptionalGeneratedFieldSchema,
  title: StrategyReportOptionalGeneratedFieldSchema,
  name: StrategyReportOptionalGeneratedFieldSchema,
  tone: StrategyReportOptionalGeneratedFieldSchema,
  bullets: StrategyReportOptionalGeneratedFieldSchema,
  items: StrategyReportOptionalGeneratedFieldSchema,
  points: StrategyReportOptionalGeneratedFieldSchema,
  details: StrategyReportOptionalGeneratedFieldSchema,
  content: StrategyReportOptionalGeneratedFieldSchema,
}).passthrough();

const StrategyReportCompetitorSchema = z.object({
  id: StrategyReportStringSchema.max(80),
  title: StrategyReportStringSchema.max(120),
  tag: StrategyReportStringSchema.max(180),
  body: StrategyReportStringSchema.max(600),
  gap: StrategyReportStringSchema.max(420),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  adaptiveScore: StrategyReportOptionalGeneratedFieldSchema,
  adaptive_score: StrategyReportOptionalGeneratedFieldSchema,
  evidenceScore: StrategyReportOptionalGeneratedFieldSchema,
  evidence_score: StrategyReportOptionalGeneratedFieldSchema,
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
  canvasMeta: StrategyReportOptionalGeneratedFieldSchema,
  matrixMeta: StrategyReportOptionalGeneratedFieldSchema,
  swotMeta: StrategyReportOptionalGeneratedFieldSchema,
  summaryTiles: z.array(StrategyReportSummaryTileSchema).min(3).max(6),
  criteriaRows: z.array(StrategyReportCriteriaRowSchema).min(4).max(12),
  canvasBlocks: z.array(StrategyReportCanvasBlockSchema).max(24),
  competitors: z.array(StrategyReportCompetitorSchema).min(3).max(12),
  swotGroups: z.array(StrategyReportSwotGroupSchema).min(4).max(8),
  swotMatrixColumnCount: StrategyReportOptionalGeneratedFieldSchema,
  swotMatrixRows: StrategyReportOptionalGeneratedFieldSchema,
  sourceRefs: StrategyReportOptionalGeneratedFieldSchema,
  searchableCopy: StrategyReportSearchableCopySchema,
  businessCanvasTopRows: StrategyReportOptionalGeneratedFieldSchema,
  businessCanvasBottomRow: StrategyReportOptionalGeneratedFieldSchema,
  generatedAt: StrategyReportOptionalStringSchema,
}).passthrough();

export const StrategyReportOutputContract = z.object({
  report: StrategyReportContentContract,
}).passthrough();

const StrategyReportAdversarialReviewContract = z.object({
  verdict: StrategyReportStringSchema.max(80),
  confidence: StrategyReportOptionalGeneratedFieldSchema,
  findings: StrategyReportOptionalGeneratedFieldSchema,
  requiredChanges: StrategyReportOptionalGeneratedFieldSchema,
  required_changes: StrategyReportOptionalGeneratedFieldSchema,
}).passthrough();

const StrategyReportProviderStringSchema = z.string().trim().min(1);

const StrategyReportProviderSummaryTileSchema = z.object({
  id: StrategyReportProviderStringSchema.max(80),
  label: StrategyReportProviderStringSchema.max(80),
  title: StrategyReportProviderStringSchema.max(160),
  detail: StrategyReportProviderStringSchema.max(360),
}).strict();

const StrategyReportProviderCriteriaRowSchema = z.object({
  id: StrategyReportProviderStringSchema.max(80),
  label: StrategyReportProviderStringSchema.max(80),
  value: StrategyReportProviderStringSchema.max(500),
}).strict();

const StrategyReportProviderCanvasBlockSchema = z.object({
  id: StrategyReportProviderStringSchema.max(80),
  title: StrategyReportProviderStringSchema.max(160),
  bullets: z.array(StrategyReportProviderStringSchema.max(300)).min(1).max(8),
}).strict();

const StrategyReportProviderCompetitorSchema = z.object({
  id: StrategyReportProviderStringSchema.max(80),
  title: StrategyReportProviderStringSchema.max(120),
  tag: StrategyReportProviderStringSchema.max(180),
  body: StrategyReportProviderStringSchema.max(600),
  gap: StrategyReportProviderStringSchema.max(420),
  adaptiveScore: z.number().min(0).max(100),
  evidenceScore: z.number().min(0).max(100),
  sourceLabel: StrategyReportProviderStringSchema.max(160),
  scoreRationale: StrategyReportProviderStringSchema.max(500),
  isAgentic30: z.boolean(),
}).strict();

const StrategyReportProviderSwotGroupSchema = z.object({
  id: StrategyReportProviderStringSchema.max(80),
  title: StrategyReportProviderStringSchema.max(120),
  tag: StrategyReportProviderStringSchema.max(80),
  bullets: z.array(StrategyReportProviderStringSchema.max(300)).min(1).max(8),
}).strict();

const StrategyReportProviderSourceRefSchema = z.object({
  id: StrategyReportProviderStringSchema.max(80),
  sourceType: StrategyReportProviderStringSchema.max(80),
  title: StrategyReportProviderStringSchema.max(220),
  url: StrategyReportProviderStringSchema.max(500),
  domain: StrategyReportProviderStringSchema.max(160),
  excerpt: StrategyReportProviderStringSchema.max(500),
}).strict();

const StrategyReportProviderContentContract = z.object({
  commandLine: StrategyReportProviderStringSchema.max(240),
  diagnosisKicker: StrategyReportProviderStringSchema.max(80),
  diagnosisTitle: StrategyReportProviderStringSchema.max(360),
  diagnosisLead: StrategyReportProviderStringSchema.max(800),
  positioningStatement: StrategyReportProviderStringSchema.max(500),
  judgement: StrategyReportProviderStringSchema.max(900),
  analysisBasisLabel: StrategyReportProviderStringSchema.max(160),
  summaryTiles: z.array(StrategyReportProviderSummaryTileSchema).min(3).max(6),
  criteriaRows: z.array(StrategyReportProviderCriteriaRowSchema).min(4).max(12),
  canvasBlocks: z.array(StrategyReportProviderCanvasBlockSchema).min(9).max(24),
  competitors: z.array(StrategyReportProviderCompetitorSchema)
    .min(STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS.competitorsMinItems)
    .max(STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS.competitorsMaxItems),
  swotGroups: z.array(StrategyReportProviderSwotGroupSchema).min(4).max(8),
  sourceRefs: z.array(StrategyReportProviderSourceRefSchema).min(1).max(24),
}).strict();

export const StrategyReportProviderOutputContract = z.object({
  report: StrategyReportProviderContentContract,
}).strict();

const StrategyReportProviderAdversarialReviewContract = z.object({
  verdict: StrategyReportProviderStringSchema.max(80),
  confidence: z.number().min(0).max(1),
  findings: z.array(StrategyReportProviderStringSchema.max(500)).min(1).max(12),
  requiredChanges: z.array(StrategyReportProviderStringSchema.max(500)).max(12),
}).strict();

const STRATEGY_REPORT_STRUCTURED_OUTPUT_CONTRACT = [
  "Structured output contract (Zod source of truth): return exactly one JSON object {\"report\": StrategyReportContent}.",
  "StrategyReportContent required string fields: commandLine, diagnosisKicker, diagnosisTitle, diagnosisLead, positioningStatement, judgement, analysisBasisLabel.",
  "summaryTiles: 3-6 items, each {id,label,title,detail}; never omit this field.",
  "criteriaRows: at least 4 items, each {id,label,value}.",
  "canvasBlocks: at least 9 items covering partners, activities, resources, value-proposition, relationships, channels, customer-segments, cost-structure, revenue-streams; each has {id,title,bullets}.",
  "competitors: 3-12 items, maximum 12, including {id:\"agentic30\", isAgentic30:true}; if you find more than 12 candidates, keep only the most strategically important matrix items. Every item has title, tag, body, gap, adaptiveScore, evidenceScore, sourceLabel, scoreRationale. adaptiveScore and evidenceScore must be 0-100 integers.",
  "swotGroups: exactly/at least strengths, weaknesses, opportunities, threats; each has {id,title,tag,bullets}.",
  "Optional but preferred: tone, swotMatrixColumnCount, swotMatrixRows, sourceRefs, searchableCopy, generatedBadge, canvasMeta, matrixMeta, swotMeta.",
].join("\n");

const STRATEGY_REPORT_ADVERSARIAL_OUTPUT_CONTRACT = [
  "Structured output contract (Zod source of truth): return exactly one JSON object with verdict, confidence, findings, requiredChanges.",
  "findings must contain at least one concrete critique. requiredChanges may be empty only when verdict is pass.",
].join("\n");

const PROVIDER_JSON_SCHEMA_ALLOWED_KEYS = new Set([
  "$anchor",
  "$defs",
  "$id",
  "$ref",
  "additionalProperties",
  "anyOf",
  "const",
  "description",
  "enum",
  "format",
  "items",
  "maxItems",
  "maximum",
  "minItems",
  "minimum",
  "oneOf",
  "properties",
  "required",
  "title",
  "type",
]);

export function buildStrategyReportProviderJsonSchema(provider = "", {
  contract = StrategyReportProviderOutputContract,
  schemaName = STRATEGY_REPORT_OUTPUT_SCHEMA_NAME,
} = {}) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const schema = sanitizeProviderJsonSchema(z.toJSONSchema(contract), { provider: normalizedProvider });
  assertStrategyReportProviderJsonSchema(schema, {
    provider: normalizedProvider,
    schemaName,
  });
  return schema;
}

export function assertStrategyReportProviderJsonSchema(schema, {
  provider = "",
  schemaName = "",
} = {}) {
  const issues = collectStrategyReportProviderJsonSchemaIssues(schema);
  if (issues.length === 0) return schema;
  const issueSummary = issues.slice(0, 5).join("; ");
  const error = new Error(
    `strategy report provider JSON schema invalid locally${schemaName ? ` for ${schemaName}` : ""}: ${issueSummary}`,
  );
  error.code = STRATEGY_REPORT_STRUCTURED_OUTPUT_FAILURE_PROVIDER_SCHEMA_INVALID_LOCAL;
  error.reason = STRATEGY_REPORT_STRUCTURED_OUTPUT_FAILURE_PROVIDER_SCHEMA_INVALID_LOCAL;
  error.structuredOutputFailure = STRATEGY_REPORT_STRUCTURED_OUTPUT_FAILURE_PROVIDER_SCHEMA_INVALID_LOCAL;
  error.structuredOutputProvider = cleanString(provider, 80) || null;
  error.structuredOutputSchemaName = cleanString(schemaName, 120) || null;
  throw error;
}

export function buildStrategyReportStructuredOutputMetadata(provider = "", {
  schemaName = STRATEGY_REPORT_OUTPUT_SCHEMA_NAME,
  limits = STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS,
} = {}) {
  return {
    structuredOutputRequested: true,
    structuredOutputProvider: cleanString(provider, 80) || null,
    structuredOutputSchemaName: cleanString(schemaName, 120) || STRATEGY_REPORT_OUTPUT_SCHEMA_NAME,
    structuredOutputSchemaLimits: limits ? deepSanitize(limits) : null,
  };
}

function buildStrategyReportPassStructuredOutput(provider = "", {
  schemaName = STRATEGY_REPORT_OUTPUT_SCHEMA_NAME,
  contract = StrategyReportProviderOutputContract,
  limits = STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS,
  mode = "",
  schemaBuilder = buildStrategyReportProviderJsonSchema,
} = {}) {
  let schema = null;
  try {
    schema = schemaBuilder(provider, { contract, schemaName });
    assertStrategyReportProviderJsonSchema(schema, { provider, schemaName });
  } catch (error) {
    error.strategyReportPassMode = mode;
    throw error;
  }
  return {
    schema,
    metadata: buildStrategyReportStructuredOutputMetadata(provider, { schemaName, limits }),
  };
}

function annotateStrategyReportProviderResult(result, metadata = null) {
  if (!metadata?.structuredOutputRequested) return result;
  if (result && typeof result === "object") {
    return {
      ...result,
      ...metadata,
      structuredOutputProvider: metadata.structuredOutputProvider || cleanString(result.provider, 80) || null,
    };
  }
  return {
    text: typeof result === "string" ? result : "",
    ...metadata,
  };
}

function sanitizeProviderJsonSchema(value, {
  provider = "",
  preserveObjectKeys = false,
} = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderJsonSchema(item, { provider }));
  }
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (!preserveObjectKeys && !PROVIDER_JSON_SCHEMA_ALLOWED_KEYS.has(key)) continue;
    if (key === "additionalProperties") {
      output.additionalProperties = false;
      continue;
    }
    output[key] = sanitizeProviderJsonSchema(child, {
      provider,
      preserveObjectKeys: key === "properties" || key === "$defs",
    });
  }
  if (output.type === "object") {
    output.additionalProperties = false;
  }
  if (provider === "gemini") {
    return output;
  }
  return output;
}

function collectStrategyReportProviderJsonSchemaIssues(value, {
  path = "<root>",
  schemaNode = true,
} = {}) {
  const issues = [];
  collectStrategyReportProviderJsonSchemaIssuesInto(value, {
    path,
    schemaNode,
    issues,
  });
  return issues;
}

function collectStrategyReportProviderJsonSchemaIssuesInto(value, {
  path,
  schemaNode,
  issues,
} = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrategyReportProviderJsonSchemaIssuesInto(item, {
      path: `${path}[${index}]`,
      schemaNode,
      issues,
    }));
    return;
  }
  if (!value || typeof value !== "object") return;

  const keys = Object.keys(value);
  if (keys.length === 0) {
    issues.push(`${path}: empty schema object`);
    return;
  }
  if (schemaNode && !hasStrategyReportProviderSchemaType(value)) {
    issues.push(`${path}: schema object missing type`);
  }
  if (Object.hasOwn(value, "additionalProperties") && value.additionalProperties !== false) {
    issues.push(`${path}.additionalProperties: must be boolean false`);
  }
  if (
    value.type === "object"
    && value.properties
    && typeof value.properties === "object"
    && !Array.isArray(value.properties)
  ) {
    const propertyKeys = Object.keys(value.properties);
    const requiredKeys = Array.isArray(value.required) ? value.required : null;
    if (!requiredKeys) {
      issues.push(`${path}.required: must include every property key`);
    } else {
      const missingRequiredKeys = propertyKeys.filter((key) => !requiredKeys.includes(key));
      if (missingRequiredKeys.length > 0) {
        issues.push(`${path}.required: missing required keys ${missingRequiredKeys.slice(0, 8).join(", ")}`);
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "properties" || key === "$defs") {
      if (!child || typeof child !== "object" || Array.isArray(child)) {
        issues.push(`${path}.${key}: must be an object map`);
        continue;
      }
      for (const [propertyName, propertySchema] of Object.entries(child)) {
        collectStrategyReportProviderJsonSchemaIssuesInto(propertySchema, {
          path: `${path}.${key}.${propertyName}`,
          schemaNode: true,
          issues,
        });
      }
      continue;
    }
    if (key === "items") {
      collectStrategyReportProviderJsonSchemaIssuesInto(child, {
        path: `${path}.items`,
        schemaNode: true,
        issues,
      });
      continue;
    }
    if (key === "anyOf" || key === "oneOf") {
      collectStrategyReportProviderJsonSchemaIssuesInto(child, {
        path: `${path}.${key}`,
        schemaNode: true,
        issues,
      });
      continue;
    }
    if (key === "additionalProperties") continue;
    collectStrategyReportProviderJsonSchemaIssuesInto(child, {
      path: `${path}.${key}`,
      schemaNode: false,
      issues,
    });
  }
}

function hasStrategyReportProviderSchemaType(value) {
  return Boolean(
    Object.hasOwn(value, "type")
      || Object.hasOwn(value, "$ref")
      || Object.hasOwn(value, "anyOf")
      || Object.hasOwn(value, "oneOf")
      || Object.hasOwn(value, "enum")
      || Object.hasOwn(value, "const"),
  );
}

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
  providerJsonSchemaBuilder = buildStrategyReportProviderJsonSchema,
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
  const directExaApiKey = extractDirectExaApiKey({
    apiKey: key,
    route: primaryRoute,
  });
  if (!directExaApiKey) {
    const startedAt = new Date().toISOString();
    const error = createDirectExaApiKeyRequiredError({
      routeLabel: primaryRoute?.label || "Exa",
      provider: primaryRoute?.provider || "",
    });
    return persistStrategyReportSnapshot({
      workspaceRoot,
      snapshot: makeStrategyReportFailureSnapshot({
        previous,
        now,
        reason: DIRECT_EXA_API_KEY_REQUIRED_REASON,
        error,
        researchSource: primaryRoute?.label || null,
        contextFingerprint,
        startedAt,
      }),
      rawProviderResult: {
        mode: "three_pass_strategy_report_failed",
        error: {
          reason: DIRECT_EXA_API_KEY_REQUIRED_REASON,
          code: DIRECT_EXA_API_KEY_REQUIRED_REASON,
          message: formatStrategyReportError(error),
          researchSource: primaryRoute?.label || null,
        },
        passes: [],
      },
      now,
    });
  }

  const startedAt = now.toISOString();
  let researchResult = null;
  let adversarialResult = null;
  let finalResult = null;
  let reportStructuredOutput = null;
  let adversarialStructuredOutput = null;
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
    reportStructuredOutput = buildStrategyReportPassStructuredOutput(primaryRoute?.provider, {
      schemaName: STRATEGY_REPORT_OUTPUT_SCHEMA_NAME,
      contract: StrategyReportProviderOutputContract,
      limits: STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS,
      mode: "exa_research",
      schemaBuilder: providerJsonSchemaBuilder,
    });

    notifyStrategyReportProgress(onProgress, {
      stage: "running_exa_research",
      researchSource: primaryRoute?.label || null,
    });
    researchResult = await providerResearcher({
      context,
      prompt: buildStrategyReportResearchPrompt(context),
      exaMcpConfig: primaryRoute.mcpConfig,
      exaResearchRoute: summarizeExaResearchRoute(primaryRoute),
      exaResearchRoutes: routes,
      exaApiKeyConfigured: Boolean(key),
      reason,
      mode: "exa_research",
      structuredOutputSchema: reportStructuredOutput.schema,
      structuredOutputSchemaName: reportStructuredOutput.metadata.structuredOutputSchemaName,
      structuredOutputSchemaLimits: reportStructuredOutput.metadata.structuredOutputSchemaLimits,
      onProgress: (progress = {}) => notifyStrategyReportProgress(onProgress, {
        ...progress,
        stage: "running_exa_research",
        researchSource: progress.researchSource || primaryRoute?.label || null,
      }),
    });
    researchResult = annotateStrategyReportProviderResult(researchResult, reportStructuredOutput.metadata);
    const candidateReport = extractStrategyReport(researchResult, { now });

    notifyStrategyReportProgress(onProgress, {
      stage: "running_adversarial_review",
      researchSource: primaryRoute?.label || null,
    });
    adversarialStructuredOutput = buildStrategyReportPassStructuredOutput(primaryRoute?.provider, {
      schemaName: STRATEGY_REPORT_ADVERSARIAL_OUTPUT_SCHEMA_NAME,
      contract: StrategyReportProviderAdversarialReviewContract,
      limits: null,
      mode: "adversarial_review",
      schemaBuilder: providerJsonSchemaBuilder,
    });
    adversarialResult = await adversarialReviewer({
      context,
      candidateReport,
      prompt: buildStrategyReportAdversarialPrompt({
        context,
        candidateReport,
      }),
      reason,
      researchSource: rawProviderResultResearchSource(researchResult) || primaryRoute.label || null,
      mode: "adversarial_review",
      structuredOutputSchema: adversarialStructuredOutput.schema,
      structuredOutputSchemaName: adversarialStructuredOutput.metadata.structuredOutputSchemaName,
      structuredOutputSchemaLimits: adversarialStructuredOutput.metadata.structuredOutputSchemaLimits,
    });
    adversarialResult = annotateStrategyReportProviderResult(adversarialResult, adversarialStructuredOutput.metadata);
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
    finalResult = await multidimensionalVerifier({
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
      structuredOutputSchema: reportStructuredOutput.schema,
      structuredOutputSchemaName: reportStructuredOutput.metadata.structuredOutputSchemaName,
      structuredOutputSchemaLimits: reportStructuredOutput.metadata.structuredOutputSchemaLimits,
    });
    finalResult = annotateStrategyReportProviderResult(finalResult, reportStructuredOutput.metadata);
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
        structuredOutputMetadataByMode: {
          exa_research: reportStructuredOutput.metadata,
          adversarial_review: adversarialStructuredOutput.metadata,
          multidimensional_verification: reportStructuredOutput.metadata,
        },
      }),
      now,
    });
  } catch (error) {
    const failureReason = cleanString(error?.reason || error?.code || reason, 120) || reason;
    return persistStrategyReportSnapshot({
      workspaceRoot,
      snapshot: makeStrategyReportFailureSnapshot({
        previous,
        now,
        reason: failureReason,
        error,
        researchSource: primaryRoute?.label || null,
        contextFingerprint,
        startedAt,
      }),
      rawProviderResult: summarizeProviderPasses({
        mode: "three_pass_strategy_report_failed",
        researchResult,
        adversarialResult,
        finalResult,
        error,
        structuredOutputMetadataByMode: {
          exa_research: reportStructuredOutput?.metadata || buildStrategyReportStructuredOutputMetadata(primaryRoute?.provider, {
            schemaName: STRATEGY_REPORT_OUTPUT_SCHEMA_NAME,
            limits: STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS,
          }),
          adversarial_review: adversarialStructuredOutput?.metadata || buildStrategyReportStructuredOutputMetadata(primaryRoute?.provider, {
            schemaName: STRATEGY_REPORT_ADVERSARIAL_OUTPUT_SCHEMA_NAME,
            limits: null,
          }),
          multidimensional_verification: reportStructuredOutput?.metadata || buildStrategyReportStructuredOutputMetadata(primaryRoute?.provider, {
            schemaName: STRATEGY_REPORT_OUTPUT_SCHEMA_NAME,
            limits: STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS,
          }),
        },
      }),
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
    rawProviderResult: deepSanitize(rawProviderResult),
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
  try {
    const parsed = extractProviderJson(rawProviderResult);
    const report = parsed?.report || parsed?.strategyReport || parsed?.strategy_report || parsed;
    const normalized = normalizeStrategyReport(report, { now });
    parseStrategyReportContract(
      StrategyReportContentContract,
      normalized,
      "strategy report structured output",
    );
    return normalized;
  } catch (error) {
    if (rawProviderResult?.structuredOutputRequested && !error?.structuredOutputFailure) {
      error.structuredOutputFailure = "normalized_contract_violation";
    }
    throw error;
  }
}

function parseStrategyReportContract(schema, value, label) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const error = new Error(`${label} contract violation: ${zodIssueSummary(parsed.error)}`);
  error.structuredOutputFailure = "normalized_contract_violation";
  throw error;
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
    canvasMeta: normalizeDisplayMeta(
      sanitized.canvasMeta ?? sanitized.canvas_meta,
      "9 blocks · dynamic report",
      120,
    ),
    matrixMeta: normalizeDisplayMeta(
      sanitized.matrixMeta ?? sanitized.matrix_meta,
      "positioning · Exa verified",
      120,
    ),
    swotMeta: normalizeDisplayMeta(
      sanitized.swotMeta ?? sanitized.swot_meta,
      "internal / external · verified",
      120,
    ),
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
    searchableCopy: [],
    generatedAt: normalizeIsoDate(sanitized.generatedAt || sanitized.generated_at) || now.toISOString(),
  };
  report.searchableCopy = normalizeSearchableCopy(
    sanitized.searchableCopy ?? sanitized.searchable_copy,
    report,
  );
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
  const seen = new Set();
  const blocks = [];
  for (const [index, block] of asArray(value).entries()) {
    if (!block || typeof block !== "object") continue;
    const number = normalizeCanvasBlockNumber(block.number ?? block.order ?? block.index)
      || String(index + 1).padStart(2, "0");
    const eyebrow = firstGeneratedString([
      block.eyebrow,
      block.label,
      block.category,
      block.subtitle,
    ], 80);
    const title = firstGeneratedString([
      block.title,
      block.name,
      block.label,
      block.eyebrow,
    ], 120);
    const normalized = {
      id: normalizeCanvasBlockId(block, index, { number, eyebrow, title }),
      number,
      eyebrow,
      title,
      bullets: normalizeGeneratedTextArray(
        block.bullets ?? block.items ?? block.points ?? block.details ?? block.content,
        8,
        280,
      ),
      tone: normalizeTone(block.tone),
    };
    if (!normalized.id || !normalized.title || normalized.bullets.length === 0) continue;
    if (seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    blocks.push(normalized);
    if (blocks.length >= 12) break;
  }
  return blocks;
}

function normalizeCanvasBlockId(block, index = 0, normalized = {}) {
  const candidates = [
    block?.id,
    block?.blockId,
    block?.block_id,
    block?.canvasBlockId,
    block?.canvas_block_id,
    block?.key,
    block?.slug,
    block?.eyebrow,
    block?.label,
    block?.title,
    block?.name,
    normalized.eyebrow,
    normalized.title,
  ];
  for (const candidate of candidates) {
    const canonicalId = canonicalCanvasBlockIdFromAlias(candidate);
    if (canonicalId) return canonicalId;
  }
  return canonicalCanvasBlockIdFromNumber(normalized.number ?? block?.number ?? block?.order ?? block?.index)
    || slugify(firstGeneratedString([block?.id, block?.title, block?.label], 80) || `block-${index + 1}`);
}

function canonicalCanvasBlockIdFromAlias(value) {
  const text = generatedFieldToString(value, 120);
  if (!text) return "";
  const keys = canvasAliasKeyVariants(text);
  for (const key of keys) {
    if (REQUIRED_CANVAS_BLOCK_IDS.includes(key)) return key;
    const canonicalId = CANVAS_BLOCK_ALIAS_BY_KEY.get(key);
    if (canonicalId) return canonicalId;
  }
  return "";
}

function canvasAliasKeyVariants(value) {
  const key = normalizeCanvasAliasKey(value);
  if (!key) return [];
  const variants = new Set([key]);
  variants.add(key.replace(/^(?:bmc-)?0?[1-9]-/, ""));
  variants.add(key.replace(/-0?[1-9]$/, ""));
  variants.add(key.replace(/^(?:block|canvas)-/, ""));
  return [...variants].filter(Boolean);
}

function canonicalCanvasBlockIdFromNumber(value) {
  const raw = generatedFieldToString(value, 40);
  const match = raw.match(/\b0?([1-9])\b/);
  if (!match) return "";
  return CANVAS_BLOCK_ID_BY_NUMBER.get(match[0]) || CANVAS_BLOCK_ID_BY_NUMBER.get(match[1]) || "";
}

function normalizeCanvasBlockNumber(value) {
  const raw = generatedFieldToString(value, 40);
  const match = raw.match(/\b0?([1-9])\b/);
  if (!match) return "";
  return match[1].padStart(2, "0");
}

function normalizeCompetitors(value) {
  const seenIds = new Set();
  const seenTitles = new Set();
  const competitors = [];
  for (const [index, competitor] of asArray(value).entries()) {
    const title = cleanString(competitor?.title || competitor?.name, 120);
    const rawId = slugify(competitor?.id || title || `competitor-${index + 1}`);
    const rawTitleId = slugify(title);
    const isAgentic30 = Boolean(
      competitor?.isAgentic30
        || competitor?.is_agentic30
        || rawId === "agentic30"
        || rawTitleId === "agentic30",
    );
    const id = isAgentic30 ? "agentic30" : rawId;
    const rawAdaptiveScore = competitor?.adaptiveScore ?? competitor?.adaptive_score;
    const rawEvidenceScore = competitor?.evidenceScore ?? competitor?.evidence_score;
    const adaptiveScore = normalizeCompetitorScore(
      rawAdaptiveScore,
      0,
    );
    const evidenceScore = normalizeCompetitorScore(
      rawEvidenceScore,
      0,
    );
    const normalized = {
      id,
      title,
      tag: cleanString(competitor?.tag || competitor?.subtitle, 180),
      body: cleanString(competitor?.body || competitor?.description, 600),
      gap: cleanString(competitor?.gap || competitor?.strategicGap || competitor?.strategic_gap, 420),
      x: matrixCoordinateFromScore(adaptiveScore),
      y: matrixCoordinateFromScore(evidenceScore, { inverted: true }),
      adaptiveScore,
      evidenceScore,
      sourceLabel: cleanString(competitor?.sourceLabel || competitor?.source_label, 160),
      sourceURL: cleanString(competitor?.sourceURL || competitor?.sourceUrl || competitor?.source_url, 500),
      sourceDisplay: cleanString(competitor?.sourceDisplay || competitor?.source_display, 160),
      verifiedAt: cleanString(competitor?.verifiedAt || competitor?.verified_at, 80),
      scoreRationale: cleanString(competitor?.scoreRationale || competitor?.score_rationale, 500),
      category: normalizeCompetitorCategory(competitor?.category, isAgentic30),
      isAgentic30,
      labelPlacement: normalizeLabelPlacement(competitor?.labelPlacement || competitor?.label_placement),
      hasMatrixScores: hasGeneratedScore(rawAdaptiveScore) && hasGeneratedScore(rawEvidenceScore),
    };
    if (!(
      normalized.id
      && normalized.title
      && normalized.tag
      && normalized.body
      && normalized.sourceLabel
      && normalized.scoreRationale
      && normalized.hasMatrixScores
    )) {
      continue;
    }
    const titleKey = slugify(normalized.title);
    if (seenIds.has(normalized.id) || (titleKey && seenTitles.has(titleKey))) continue;
    seenIds.add(normalized.id);
    if (titleKey) seenTitles.add(titleKey);
    const { hasMatrixScores, ...publicCompetitor } = normalized;
    competitors.push(publicCompetitor);
  }
  const limited = competitors.slice(0, 12);
  const agentic30 = competitors.find((competitor) => competitor.id === "agentic30" && competitor.isAgentic30);
  if (agentic30 && !limited.some((competitor) => competitor.id === "agentic30" && competitor.isAgentic30)) {
    limited[Math.max(0, limited.length - 1)] = agentic30;
  }
  return limited;
}

function normalizeCompetitorScore(value, fallback = 0) {
  const fraction = parseScoreFraction(value);
  if (fraction) {
    return clampInt(Math.round((fraction.numerator / fraction.denominator) * 100), 0, 100, fallback);
  }
  const parsed = parseGeneratedNumber(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed > 0 && parsed <= 1) return clampInt(Math.round(parsed * 100), 0, 100, fallback);
  if (parsed > 1 && parsed <= 10) return clampInt(Math.round(parsed * 10), 0, 100, fallback);
  return clampInt(Math.round(parsed), 0, 100, fallback);
}

function parseScoreFraction(value) {
  const raw = generatedFieldToString(value, 80);
  const match = raw.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return { numerator, denominator };
}

function parseGeneratedNumber(value) {
  if (typeof value === "number") return value;
  const raw = generatedFieldToString(value, 80);
  if (!raw) return Number.NaN;
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

function matrixCoordinateFromScore(score, { inverted = false } = {}) {
  const coordinate = clampNumber(score / 100, 0, 1, 0);
  const value = inverted ? 1 - coordinate : coordinate;
  return Number(value.toFixed(4));
}

function hasGeneratedScore(value) {
  if (typeof value === "number") return Number.isFinite(value);
  return /-?\d/.test(generatedFieldToString(value, 80));
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
    findings: normalizeReviewTextArray(normalized.findings, 12, 420),
    requiredChanges: normalizeReviewTextArray(normalized.requiredChanges || normalized.required_changes, 12, 420),
  };
}

function normalizeReviewTextArray(value, maxItems = 12, maxLength = 420) {
  return asArray(value)
    .map((item) => reviewItemToString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function reviewItemToString(item, maxLength = 420) {
  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
    return cleanString(item, maxLength);
  }
  if (!item || typeof item !== "object") return "";
  const parts = [
    item.finding,
    item.title,
    item.issue,
    item.summary,
    item.risk,
    item.critique,
    item.rationale,
    item.evidence,
    item.recommendation,
    item.requiredChange,
    item.required_change,
    item.change,
    item.action,
  ].map((part) => cleanString(part, Math.ceil(maxLength / 2))).filter(Boolean);
  if (parts.length > 0) return cleanString(parts.join(" · "), maxLength);
  return cleanString(JSON.stringify(item), maxLength);
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
  mode = "three_pass_strategy_report",
  researchResult = null,
  adversarialResult = null,
  finalResult = null,
  error = null,
  structuredOutputMetadataByMode = {},
} = {}) {
  const failedMode = error
    ? inferStrategyReportFailedPassMode({ researchResult, adversarialResult, finalResult, error })
    : null;
  const summary = {
    mode,
    passes: [
      summarizeProviderResult("exa_research", researchResult, {
        structuredOutputMetadata: structuredOutputMetadataByMode.exa_research,
        error: failedMode === "exa_research" ? error : null,
      }),
      summarizeProviderResult("adversarial_review", adversarialResult, {
        structuredOutputMetadata: structuredOutputMetadataByMode.adversarial_review,
        error: failedMode === "adversarial_review" ? error : null,
      }),
      summarizeProviderResult("multidimensional_verification", finalResult, {
        structuredOutputMetadata: structuredOutputMetadataByMode.multidimensional_verification,
        error: failedMode === "multidimensional_verification" ? error : null,
      }),
    ],
  };
  if (error) {
    summary.error = formatStrategyReportError(error);
  }
  return summary;
}

function summarizeProviderResult(mode, result, {
  structuredOutputMetadata = null,
  error = null,
} = {}) {
  const metadata = result?.structuredOutputRequested
    ? result
    : structuredOutputMetadata;
  const summary = {
    mode,
    provider: cleanString(result?.provider, 80) || null,
    model: cleanString(result?.model, 160) || null,
    researchSource: rawProviderResultResearchSource(result),
    textChars: String(result?.text || "").length,
  };
  if (metadata?.structuredOutputRequested) {
    summary.structuredOutputRequested = true;
    summary.structuredOutputProvider = cleanString(
      metadata.structuredOutputProvider || result?.provider || "",
      80,
    ) || null;
    summary.structuredOutputSchemaName = cleanString(metadata.structuredOutputSchemaName, 120) || null;
    summary.structuredOutputSchemaLimits = deepSanitize(metadata.structuredOutputSchemaLimits || null);
  }
  const structuredOutputFailure = structuredOutputFailureFromError(error)
    || cleanString(result?.structuredOutputFailure, 80);
  if (structuredOutputFailure) {
    summary.structuredOutputFailure = structuredOutputFailure;
  }
  const parsedReportShape = summarizeParsedReportShape(result);
  if (parsedReportShape) {
    summary.parsedReportShape = parsedReportShape;
  }
  return summary;
}

function inferStrategyReportFailedPassMode({
  researchResult = null,
  adversarialResult = null,
  finalResult = null,
  error = null,
} = {}) {
  const explicitMode = cleanString(error?.strategyReportPassMode, 80);
  if (explicitMode) return explicitMode;
  if (finalResult) return "multidimensional_verification";
  if (adversarialResult) {
    const message = String(error?.message || "");
    return /adversarial/i.test(message)
      ? "adversarial_review"
      : "multidimensional_verification";
  }
  return researchResult ? "exa_research" : "exa_research";
}

function structuredOutputFailureFromError(error) {
  return cleanString(error?.structuredOutputFailure, 80) || null;
}

function summarizeParsedReportShape(result) {
  try {
    const parsed = extractProviderJson(result);
    const report = parsed?.report || parsed?.strategyReport || parsed?.strategy_report || parsed;
    if (!report || typeof report !== "object") return null;
    const summaryTiles = asArray(report.summaryTiles || report.summary_tiles);
    const criteriaRows = asArray(report.criteriaRows || report.criteria_rows);
    const canvasBlocks = asArray(report.canvasBlocks || report.canvas_blocks);
    const competitors = asArray(report.competitors || report.competitorMatrix || report.competitor_matrix);
    const swotGroups = asArray(report.swotGroups || report.swot_groups);
    const sourceRefs = asArray(report.sourceRefs || report.source_refs);
    return {
      summaryTileCount: summaryTiles.length,
      criteriaRowCount: criteriaRows.length,
      canvasBlockCount: canvasBlocks.length,
      canvasBlocks: canvasBlocks.slice(0, 24).map((block, index) => summarizeCanvasBlockShape(block, index)),
      competitorCount: competitors.length,
      competitorIds: competitors.slice(0, 24).map((competitor, index) => summarizeCompetitorShapeId(competitor, index)).filter(Boolean),
      swotGroupIds: swotGroups.slice(0, 12).map((group) => slugify(group?.id || group?.title)).filter(Boolean),
      sourceRefCount: sourceRefs.length,
    };
  } catch {
    return null;
  }
}

function summarizeCompetitorShapeId(competitor, index = 0) {
  if (!competitor || typeof competitor !== "object") return `competitor-${index + 1}`;
  const rawId = slugify(competitor.id || competitor.title || competitor.name || `competitor-${index + 1}`);
  const titleId = slugify(competitor.title || competitor.name);
  return competitor.isAgentic30 || competitor.is_agentic30 || rawId === "agentic30" || titleId === "agentic30"
    ? "agentic30"
    : rawId;
}

function summarizeCanvasBlockShape(block, index = 0) {
  if (!block || typeof block !== "object") {
    return {
      index,
      type: Array.isArray(block) ? "array" : typeof block,
    };
  }
  const number = normalizeCanvasBlockNumber(block.number ?? block.order ?? block.index) || null;
  const eyebrow = firstGeneratedString([block.eyebrow, block.label], 80) || null;
  const title = firstGeneratedString([block.title, block.name], 120) || null;
  return {
    index,
    id: firstGeneratedString([
      block.id,
      block.blockId,
      block.block_id,
      block.canvasBlockId,
      block.canvas_block_id,
      block.key,
      block.slug,
    ], 80) || null,
    number,
    eyebrow,
    title,
    canonicalId: normalizeCanvasBlockId(block, index, { number, eyebrow, title }) || null,
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
  const strictStructuredJson = Boolean(rawProviderResult?.structuredOutputRequested);
  if (!trimmed) {
    const error = new Error("strategy report provider returned empty text");
    if (strictStructuredJson) error.structuredOutputFailure = "invalid_json_text";
    throw error;
  }
  try {
    return JSON.parse(trimmed);
  } catch (parseError) {
    if (strictStructuredJson) {
      const error = new Error("strategy report provider structured output was not valid JSON text");
      error.cause = parseError;
      error.structuredOutputFailure = "invalid_json_text";
      throw error;
    }
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
  const { generatedAt, ...stableContext } = context || {};
  return createHash("sha256")
    .update(JSON.stringify(stableContext))
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
  if (
    PRIVATE_RAW_TEXT_PATTERN.test(text)
    && (
      !isSafeDirectExaFailureSummary(text)
      || PRIVATE_RAW_TEXT_PATTERN_EXCEPT_API_KEY.test(text)
    )
  ) {
    return "[redacted-private]";
  }
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    text = text.replace(pattern, "[redacted-private]");
  }
  return text;
}

function isSafeDirectExaFailureSummary(text = "") {
  return String(text || "").startsWith("Exa Search API 호출이 실패했습니다");
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

function normalizeGeneratedTextArray(value, maxItems = 8, maxLength = 240) {
  const rawItems = Array.isArray(value)
    ? value
    : value === undefined || value === null ? [] : [value];
  return rawItems
    .map((item) => generatedFieldToString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function firstGeneratedString(values, maxLength = 240) {
  for (const value of values) {
    const text = generatedFieldToString(value, maxLength);
    if (text) return text;
  }
  return "";
}

function generatedFieldToString(value, maxLength = 240) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return cleanString(value, maxLength);
  }
  if (Array.isArray(value)) {
    return cleanString(
      value
        .map((item) => generatedFieldToString(item, Math.ceil(maxLength / 2)))
        .filter(Boolean)
        .join(" · "),
      maxLength,
    );
  }
  if (!value || typeof value !== "object") return "";
  for (const key of ["text", "label", "summary", "detail", "description", "title", "note", "value", "body", "content", "name"]) {
    const text = generatedFieldToString(value[key], maxLength);
    if (text) return text;
  }
  return "";
}

function normalizeSearchableCopy(value, report = {}) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string" ? [value] : [];
  const normalized = rawItems
    .map((item) => (typeof item === "string" || typeof item === "number" ? cleanString(item, 500) : ""))
    .filter(Boolean)
    .slice(0, 80);
  if (normalized.length > 0) return normalized;
  return normalizeStringArray([
    report.diagnosisTitle,
    report.diagnosisLead,
    report.positioningStatement,
    report.judgement,
    ...(report.summaryTiles || []).flatMap((tile) => [tile.title, tile.detail]),
    ...(report.competitors || []).flatMap((competitor) => [competitor.title, competitor.tag, competitor.body]),
  ], 80, 500);
}

function normalizeDisplayMeta(value, fallback, maxLength = 120) {
  const text = displayMetaToString(value, maxLength);
  return text || cleanString(fallback, maxLength);
}

function displayMetaToString(value, maxLength = 120) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return cleanString(value, maxLength);
  }
  if (Array.isArray(value)) {
    return cleanString(
      value
        .map((item) => displayMetaToString(item, Math.ceil(maxLength / 2)))
        .filter(Boolean)
        .join(" · "),
      maxLength,
    );
  }
  if (!value || typeof value !== "object") return "";
  for (const key of ["text", "label", "summary", "detail", "description", "title", "note", "value"]) {
    const text = displayMetaToString(value[key], maxLength);
    if (text) return text;
  }
  return "";
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

function normalizeCanvasAliasKey(value) {
  return slugify(
    String(value ?? "")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/_/g, "-"),
  );
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
  const reason = cleanString(error?.reason || error?.code, 120);
  if (reason === DIRECT_EXA_SEARCH_FAILED_REASON) {
    return formatDirectExaSearchFailureError(error);
  }
  return cleanString(error?.message || error || "Strategy report refresh failed.", 500)
    || "Strategy report refresh failed.";
}

function formatDirectExaSearchFailureError(error) {
  const details = [];
  if (Array.isArray(error?.failures)) {
    for (const failure of error.failures) {
      const detail = cleanDirectExaFailureString(failure?.error, 220);
      if (detail) details.push(detail);
      if (details.length >= 3) break;
    }
  }
  if (details.length === 0) {
    const detail = cleanDirectExaFailureString(error?.message || error, 420);
    if (detail) details.push(detail);
  }
  const suffix = details.length > 0
    ? `: ${details.join(" | ")}`
    : ". Exa 연결/API 키/네트워크 응답을 확인하세요.";
  return `Exa Search API 호출이 실패했습니다${suffix}`;
}

function cleanDirectExaFailureString(value, maxLength = 300) {
  let text = String(value ?? "");
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    text = text.replace(pattern, "[redacted-private]");
  }
  text = text.replace(
    /("(?:x-api-key|api[_-]?key|authorization)"\s*:\s*")[^"]*(")/gi,
    "$1[redacted-private]$2",
  );
  text = text.replace(
    /\b(?:x-api-key|api[_ -]?key|authorization)\s*[:=]\s*[^,\s|}]+/gi,
    (match) => `${match.split(/[:=]/)[0]}=[redacted-private]`,
  );
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

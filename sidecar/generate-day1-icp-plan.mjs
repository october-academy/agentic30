import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";

import {
  buildReadOnlyWorkspaceCanUseTool,
  READ_ONLY_WORKSPACE_ALLOWED_TOOLS,
} from "./read-only-workspace-tool-policy.mjs";
import { normalizeProductName } from "./onboarding-hypothesis.mjs";
import { extractWorkspaceEvidence } from "./workspace-signal-extractor.mjs";

export const DAY1_ICP_PLAN_SCHEMA_VERSION = 1;
export const DAY1_ALIGNMENT_PLAN_SCHEMA_VERSION = 1;
export const DAY1_SIGNAL_DIGEST_SCHEMA_VERSION = 1;
export const DAY1_ICP_PLAN_MIN_CONFIDENCE = 0.35;
export const DAY1_ALIGNMENT_PLAN_MIN_CONFIDENCE = 0.35;
export const DAY1_ICP_PLAN_DEFAULT_TIMEOUT_MS = 30_000;

const DAY1_ALIGNMENT_FRONTIER_OPTION_COUNT = 5;
const DAY1_ALIGNMENT_FRONTIER_MAX_ANTI_SIGNAL_OPTIONS = 1;
const QUESTION_DIMENSIONS = Object.freeze([
  "must_have",
  "core_need",
  "current_alternative",
  "buyer_user",
  "activation_or_success_signal",
  "willingness_to_pay",
  "bad_fit_boundary",
  "reference_customer",
]);

const MAX_EVIDENCE_REFS = 8;
const MAX_DOC_CHARS = 8_000;
const MAX_CONTEXT_CHARS = 28_000;
const MAX_SOURCE_EVIDENCE_FILES = 10;
const MAX_SOURCE_FILE_CHARS = 4_000;
const MAX_SOURCE_SIGNAL_LINES = 30;
const DAY1_ALIGNMENT_QUALITY_GATE_THRESHOLD = 7.0;
const EVIDENCE_LIMITED_LABEL = "근거 부족";
const SIGNAL_DIGEST_ROW_ORDER = Object.freeze(["project", "goal", "icp", "pain", "outcome", "evidence"]);
const SIGNAL_DIGEST_LABELS = Object.freeze({
  project: "프로젝트",
  goal: "목표",
  icp: "고객",
  pain: "문제",
  outcome: "확인할 행동",
  evidence: "근거",
});
const SIGNAL_DIGEST_VALUE_LIMITS = Object.freeze({
  project: 90,
  goal: 120,
  icp: 90,
  pain: 80,
  outcome: 110,
  evidence: 120,
});
const USER_FACING_GENERIC_PROJECT_NAME = "이 프로젝트";
const USER_FACING_GENERIC_PAIN_POINT = "핵심 문제 확인 필요";
const USER_FACING_GENERIC_PROBLEM = "핵심 문제 확인 필요";

const SOURCE_EVIDENCE_EXTENSIONS = new Set([
  ".swift",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".kt",
  ".kts",
]);
const SOURCE_EVIDENCE_DENY_SEGMENTS = new Set([
  ".git",
  ".build",
  ".next",
  ".turbo",
  "build",
  "dist",
  "DerivedData",
  "node_modules",
  "sidecar-build",
  "vendor",
  "coverage",
]);
const SOURCE_SIGNAL_PATTERN = /(customer|user|problem|mission|goal|value|pricing|onboarding|landing|persona|audience|target|pain|friction|stuck|success|outcome|proof|고객|사용자|문제|목표|가치|미션|가격|온보딩|랜딩|페르소나|타깃|대상|통증|막힘|성공|결과|검증)/i;
const GOAL_SIGNAL_PATTERN = /(goal|mission|purpose|success|north\s*star|proof\s*target|objective|목표|미션|목적|성공\s*기준|검증\s*목표)/i;
const ICP_SIGNAL_PATTERN = /(customer|user|persona|audience|target|icp|고객|사용자|페르소나|타깃|대상)/i;
const PAIN_SIGNAL_PATTERN = /(problem|pain|friction|stuck|blocked|struggle|문제|통증|막힘|불편|어려움)/i;
const OUTCOME_SIGNAL_PATTERN = /(outcome|success|result|activation|validation|signal|proof|행동|결과|성공|검증|확인|신호|대화|시장)/i;

const SignalDigestRowSchema = z.object({
  key: z.enum(SIGNAL_DIGEST_ROW_ORDER),
  label: z.string().min(1).max(24),
  value: z.string().min(1),
  tone: z.enum(["body", "strong", "mark", "code", "muted", "accent"]).optional(),
}).passthrough();

export const Day1SignalDigestSchema = z.object({
  schemaVersion: z.literal(DAY1_SIGNAL_DIGEST_SCHEMA_VERSION),
  rows: z.array(SignalDigestRowSchema).length(SIGNAL_DIGEST_ROW_ORDER.length),
  summary: z.string().min(1).max(160),
}).superRefine((digest, ctx) => {
  digest.rows.forEach((row, index) => {
    const expectedKey = SIGNAL_DIGEST_ROW_ORDER[index];
    if (row.key !== expectedKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rows", index, "key"],
        message: `signalDigest.rows[${index}].key must be "${expectedKey}"`,
      });
    }
    const max = SIGNAL_DIGEST_VALUE_LIMITS[row.key];
    if (max && row.value.length > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: max,
        inclusive: true,
        type: "string",
        path: ["rows", index, "value"],
        message: `signalDigest row "${row.key}" must be ${max} characters or fewer`,
      });
    }
  });
});

export const Day1AlignmentSdkOutputSchema = z.object({
  schemaVersion: z.literal(DAY1_ALIGNMENT_PLAN_SCHEMA_VERSION),
  projectGoal: z.string().min(1),
  mission: z.string().min(1),
  signals: z.object({}).passthrough(),
  components: z.object({}).passthrough(),
  alignmentStatement: z.object({}).passthrough(),
  qualityGate: z.object({}).passthrough(),
  firstInterviewMessage: z.object({}).passthrough(),
  day2Handoff: z.object({}).passthrough(),
  confidence: z.number().min(0).max(1).optional(),
  signalDigest: Day1SignalDigestSchema,
}).passthrough();

export async function generateDay1IcpPlan({
  workspaceRoot,
  scanResult = {},
  onboardingHypothesis = null,
  localDiscovery = null,
  now = new Date(),
  fsImpl = fs,
} = {}) {
  const workspaceEvidence = await extractWorkspaceEvidence(workspaceRoot, {
    scanPaths: scanResult,
    includeSource: true,
    fsImpl,
  }).catch(() => null);
  const evidence = workspaceEvidence?.evidence?.length
    ? workspaceEvidence.evidence.map(workspaceEvidenceRefToDay1Ref)
    : await collectDay1IcpEvidence({
        workspaceRoot,
        scanResult,
        fsImpl,
      });
  const signals = buildDay1IcpSignals({
    workspaceRoot,
    scanResult,
    onboardingHypothesis,
    localDiscovery,
    evidence,
    workspaceEvidence,
  });
  const questions = buildAdaptiveQuestions(signals);
  const plan = {
    schemaVersion: DAY1_ICP_PLAN_SCHEMA_VERSION,
    source: "deterministic",
    generatedAt: toIso(now),
    confidence: confidenceScore(signals.confidence, evidence.length, questions.length),
    fellBackToDeterministic: false,
    mission: buildMission(signals),
    signals,
    questions,
    icpDraft: buildIcpDraft(signals, questions),
    antiIcp: buildAntiIcp(signals),
    firstInterviewMessage: buildFirstInterviewMessage(signals, questions),
  };
  return normalizeDay1IcpPlan(plan) || fallbackDay1IcpPlan({ workspaceRoot, now });
}

export async function generateDay1AlignmentPlan({
  workspaceRoot,
  scanResult = {},
  onboardingHypothesis = null,
  localDiscovery = null,
  now = new Date(),
  fsImpl = fs,
} = {}) {
  const workspaceEvidence = await extractWorkspaceEvidence(workspaceRoot, {
    scanPaths: scanResult,
    includeSource: true,
    fsImpl,
  }).catch(() => null);
  const evidence = workspaceEvidence?.evidence?.length
    ? workspaceEvidence.evidence.map(workspaceEvidenceRefToDay1Ref)
    : await collectDay1IcpEvidence({
        workspaceRoot,
        scanResult,
        fsImpl,
      });
  const signals = buildDay1IcpSignals({
    workspaceRoot,
    scanResult,
    onboardingHypothesis,
    localDiscovery,
    evidence,
    workspaceEvidence,
  });
  const projectGoal = buildProjectGoal({
    signals,
    onboardingHypothesis,
    evidence,
  });
  const components = buildAlignmentComponents({
    signals,
    projectGoal,
  });
  const alignmentStatement = buildAlignmentStatement({
    projectGoal,
    components,
  });
  const qualityGate = buildAlignmentQualityGate({
    projectGoal,
    signals,
    components,
    evidence,
  });
  const plan = {
    schemaVersion: DAY1_ALIGNMENT_PLAN_SCHEMA_VERSION,
    source: "deterministic",
    generatedAt: toIso(now),
    confidence: confidenceScore(signals.confidence, evidence.length, Object.keys(components).length),
    fellBackToDeterministic: false,
    projectGoal,
    mission: buildAlignmentMission({ signals, projectGoal }),
    signals,
    components,
    alignmentStatement,
    qualityGate,
    firstInterviewMessage: buildFirstInterviewMessage(
      signals,
      alignmentComponentsAsQuestions(components),
    ),
    day2Handoff: buildDay2Handoff({
      signals,
      projectGoal,
      alignmentStatement,
      qualityGate,
    }),
  };
  plan.signalDigest = buildConciseSignalDigest(plan);
  return normalizeDay1AlignmentPlan(plan) || fallbackDay1AlignmentPlan({ workspaceRoot, now });
}

export async function composeDay1IcpPlan({
  workspaceRoot,
  deterministicPlan,
  queryImpl,
  now = new Date(),
  timeoutMs = DAY1_ICP_PLAN_DEFAULT_TIMEOUT_MS,
} = {}) {
  const fallback = normalizeDay1IcpPlan(deterministicPlan)
    || fallbackDay1IcpPlan({ workspaceRoot, now });

  if (typeof queryImpl !== "function") {
    return {
      ...fallback,
      source: "deterministic",
      fellBackToDeterministic: true,
    };
  }

  let composed = null;
  try {
    const canUseTool = buildReadOnlyWorkspaceCanUseTool({ workspaceRoot });
    const text = await runPlanComposerWithTimeout({
      queryImpl,
      prompt: buildDay1IcpComposerPrompt(fallback),
      workspaceRoot,
      canUseTool,
      timeoutMs,
    });
    composed = parseDay1IcpPlanText(text);
  } catch {
    composed = null;
  }

  const normalized = normalizeDay1IcpPlan(composed);
  if (!normalized || (normalized.confidence ?? 0) < DAY1_ICP_PLAN_MIN_CONFIDENCE) {
    return {
      ...fallback,
      source: "deterministic",
      fellBackToDeterministic: true,
    };
  }

  return {
    ...normalized,
    source: "llm",
    generatedAt: normalized.generatedAt || toIso(now),
    fellBackToDeterministic: false,
  };
}

export async function composeDay1AlignmentPlan({
  workspaceRoot,
  deterministicPlan,
  queryImpl,
  frontierResults = null,
  now = new Date(),
  timeoutMs = DAY1_ICP_PLAN_DEFAULT_TIMEOUT_MS,
} = {}) {
  const fallback = normalizeDay1AlignmentPlan(deterministicPlan)
    || fallbackDay1AlignmentPlan({ workspaceRoot, now });

  if (Array.isArray(frontierResults)) {
    const frontierPlan = composeFrontierDay1AlignmentPlan({
      frontierResults,
      fallback,
      now,
    });
    if (frontierPlan) return frontierPlan;
    if (typeof queryImpl !== "function") {
      return {
        ...fallback,
        source: "deterministic",
        fellBackToDeterministic: true,
      };
    }
  }

  if (typeof queryImpl !== "function") {
    return {
      ...fallback,
      source: "deterministic",
      fellBackToDeterministic: true,
    };
  }

  let composed = null;
  try {
    const canUseTool = buildReadOnlyWorkspaceCanUseTool({ workspaceRoot });
    const text = await runPlanComposerWithTimeout({
      queryImpl,
      prompt: buildDay1AlignmentComposerPrompt(fallback),
      workspaceRoot,
      canUseTool,
      timeoutMs,
    });
    composed = parseDay1IcpPlanText(text);
  } catch {
    composed = null;
  }

  const sdkOutput = Day1AlignmentSdkOutputSchema.safeParse(composed);
  const normalized = sdkOutput.success ? normalizeDay1AlignmentPlan(sdkOutput.data) : null;
  if (!normalized || (normalized.confidence ?? 0) < DAY1_ALIGNMENT_PLAN_MIN_CONFIDENCE) {
    return {
      ...fallback,
      source: "deterministic",
      fellBackToDeterministic: true,
    };
  }

  return {
    ...normalized,
    source: "llm",
    generatedAt: normalized.generatedAt || toIso(now),
    fellBackToDeterministic: false,
  };
}

function composeFrontierDay1AlignmentPlan({ frontierResults, fallback, now }) {
  const candidates = frontierResults
    .map((result, index) => normalizeFrontierAlignmentCandidate(result, index))
    .filter(Boolean);
  if (!candidates.length) return null;

  candidates.sort((a, b) => frontierAlignmentPlanScore(b.plan) - frontierAlignmentPlanScore(a.plan));
  const merged = mergeFrontierAlignmentCandidatePlans(candidates.map((candidate) => candidate.plan), fallback);
  const normalized = merged ? normalizeDay1AlignmentPlan(merged) : null;
  if (
    !normalized
    || (normalized.confidence ?? 0) < DAY1_ALIGNMENT_PLAN_MIN_CONFIDENCE
    || !frontierAlignmentPlanPassesStrictOptionAudit(normalized)
  ) {
    return null;
  }

  return {
    ...normalized,
    source: candidates.length > 1 ? "frontier_ensemble" : "frontier_single",
    generatedAt: normalized.generatedAt || toIso(now),
    fellBackToDeterministic: false,
  };
}

function normalizeFrontierAlignmentCandidate(result, index) {
  const text = typeof result === "string"
    ? result
    : result?.text || result?.output || result?.response || "";
  const parsed = parseDay1IcpPlanText(text);
  const sdkOutput = Day1AlignmentSdkOutputSchema.safeParse(parsed);
  if (!sdkOutput.success) return null;
  const normalized = normalizeDay1AlignmentPlan(
    sanitizeFrontierAlignmentCandidateBeforeNormalize(sdkOutput.data),
  );
  if (!normalized || (normalized.confidence ?? 0) < DAY1_ALIGNMENT_PLAN_MIN_CONFIDENCE) return null;
  return {
    provider: cleanToken(result?.provider) || `frontier_${index + 1}`,
    model: cleanToken(result?.model),
    plan: normalized,
  };
}

function sanitizeFrontierAlignmentCandidateBeforeNormalize(value) {
  if (!value || typeof value !== "object") return value;
  const components = value.components && typeof value.components === "object" ? value.components : {};
  const planContext = {
    projectGoal: value.projectGoal || value.project_goal,
    alignmentStatement: value.alignmentStatement || value.alignment_statement,
  };
  const sanitizeComponent = (component, dimension) => {
    if (!component || typeof component !== "object" || !Array.isArray(component.options)) return component;
    return {
      ...component,
      options: component.options.filter((optionValue) =>
        !looksLikeContaminatedAlignmentChoice(optionValue?.label || optionValue?.title, dimension, planContext)
      ),
    };
  };
  return {
    ...value,
    components: {
      ...components,
      icp: sanitizeComponent(components.icp, "icp"),
      painPoint: sanitizeComponent(components.painPoint || components.pain_point, "pain_point"),
      outcome: sanitizeComponent(components.outcome, "outcome"),
    },
  };
}

function mergeFrontierAlignmentCandidatePlans(candidatePlans, fallback) {
  const primary = candidatePlans[0];
  if (!primary?.components || !fallback?.components) return null;

  const components = {
    icp: mergeFrontierAlignmentComponent({
      dimension: "icp",
      candidateComponents: candidatePlans.map((plan) => plan.components?.icp),
      fallbackComponent: fallback.components.icp,
      plan: primary,
    }),
    painPoint: mergeFrontierAlignmentComponent({
      dimension: "pain_point",
      candidateComponents: candidatePlans.map((plan) => plan.components?.painPoint),
      fallbackComponent: fallback.components.painPoint,
      plan: primary,
    }),
    outcome: mergeFrontierAlignmentComponent({
      dimension: "outcome",
      candidateComponents: candidatePlans.map((plan) => plan.components?.outcome),
      fallbackComponent: fallback.components.outcome,
      plan: primary,
    }),
  };
  if (!components.icp || !components.painPoint || !components.outcome) return null;

  const merged = {
    ...primary,
    components,
    confidence: Math.max(primary.confidence ?? 0, fallback.confidence ?? 0, DAY1_ALIGNMENT_PLAN_MIN_CONFIDENCE),
  };
  merged.alignmentStatement = normalizeAlignmentStatement(primary.alignmentStatement, {
    projectGoal: merged.projectGoal,
    components,
    signals: merged.signals,
  }) || buildAlignmentStatement({ projectGoal: merged.projectGoal, components });
  merged.signalDigest = normalizeSignalDigest(primary.signalDigest, merged) || buildConciseSignalDigest(merged);
  return merged;
}

function mergeFrontierAlignmentComponent({
  dimension,
  candidateComponents,
  fallbackComponent,
  plan,
}) {
  const primary = candidateComponents.find(Boolean) || fallbackComponent;
  const rawOptions = [
    ...candidateComponents.flatMap((component) => Array.isArray(component?.options) ? component.options : []),
    ...(Array.isArray(fallbackComponent?.options) ? fallbackComponent.options : []),
  ];
  const options = selectFrontierAlignmentOptions(rawOptions, { dimension, plan });
  if (!options) return null;
  return {
    ...primary,
    options,
  };
}

function selectFrontierAlignmentOptions(rawOptions, { dimension, plan }) {
  const rankedOptions = uniqueBy(
    rawOptions
      .map((optionValue) => prepareFrontierAlignmentOption(optionValue, dimension))
      .filter((optionValue) => frontierAlignmentOptionPassesStrictAudit(optionValue, dimension, plan))
      .sort((a, b) => frontierAlignmentOptionScore(b) - frontierAlignmentOptionScore(a)),
    (optionValue) => comparableOptionText(optionValue.label),
  );
  const selected = [];
  let antiSignalCount = 0;
  for (const optionValue of rankedOptions) {
    if (optionValue.antiSignal === true) {
      if (antiSignalCount >= DAY1_ALIGNMENT_FRONTIER_MAX_ANTI_SIGNAL_OPTIONS) continue;
      antiSignalCount += 1;
    }
    selected.push(optionValue);
    if (selected.length >= DAY1_ALIGNMENT_FRONTIER_OPTION_COUNT) break;
  }
  if (selected.length !== DAY1_ALIGNMENT_FRONTIER_OPTION_COUNT) return null;
  return selected.map((optionValue, index) => ({
    ...optionValue,
    id: cleanToken(optionValue.id) || `o${index + 1}`,
  }));
}

function prepareFrontierAlignmentOption(optionValue, dimension) {
  const normalized = normalizeAlignmentOption(optionValue, 0);
  if (!normalized) return null;
  const evidenceLabel = cleanText(normalized.evidenceLabel)
    || cleanText(optionValue?.evidence_label)
    || "근거: frontier synthesis";
  const evidenceLimited = normalized.evidenceLimited === true || evidenceLabel === EVIDENCE_LIMITED_LABEL;
  return {
    ...normalized,
    description: cleanText(normalized.description)
      || frontierAlignmentOptionDescription(normalized, dimension, evidenceLabel),
    evidenceLabel,
    evidenceLimited,
  };
}

function frontierAlignmentOptionDescription(optionValue, dimension, evidenceLabel) {
  const label = cleanSignalText(optionValue?.label);
  const evidence = evidenceLabel === EVIDENCE_LIMITED_LABEL ? "근거 부족" : evidenceLabel;
  if (dimension === "icp") {
    return `${label} 후보가 이번 주 실제 대화 가능한 고객인지 확인합니다. · ${evidence}`;
  }
  if (dimension === "pain_point") {
    return `${label} 문제가 시간, 돈, 리스크 비용으로 반복되는지 확인합니다. · ${evidence}`;
  }
  return `${label} 신호를 최근 사건, 현재 대안, 지불 의향 같은 행동으로 확인합니다. · ${evidence}`;
}

function frontierAlignmentPlanPassesStrictOptionAudit(plan) {
  return [
    ["icp", plan.components?.icp],
    ["pain_point", plan.components?.painPoint],
    ["outcome", plan.components?.outcome],
  ].every(([dimension, component]) => {
    const options = Array.isArray(component?.options) ? component.options : [];
    const antiSignalCount = options.filter((optionValue) => optionValue?.antiSignal === true).length;
    return options.length === DAY1_ALIGNMENT_FRONTIER_OPTION_COUNT
      && antiSignalCount <= DAY1_ALIGNMENT_FRONTIER_MAX_ANTI_SIGNAL_OPTIONS
      && options.every((optionValue) => frontierAlignmentOptionPassesStrictAudit(optionValue, dimension, plan));
  });
}

function frontierAlignmentOptionPassesStrictAudit(optionValue, dimension, plan) {
  if (!optionValue) return false;
  if (!cleanText(optionValue.description)) return false;
  if (!cleanText(optionValue.evidenceLabel)) return false;
  if (looksLikeContaminatedAlignmentChoice(optionValue.label, dimension, plan)) return false;
  return alignmentOptionPassesQualityAudit(optionValue, dimension, plan);
}

function frontierAlignmentPlanScore(plan) {
  if (!plan?.components) return 0;
  return [
    ["icp", plan.components.icp],
    ["pain_point", plan.components.painPoint],
    ["outcome", plan.components.outcome],
  ].reduce((total, [dimension, component]) => {
    const options = Array.isArray(component?.options) ? component.options : [];
    return total + options.reduce((score, optionValue) => {
      const prepared = prepareFrontierAlignmentOption(optionValue, dimension);
      return score + (frontierAlignmentOptionPassesStrictAudit(prepared, dimension, plan)
        ? frontierAlignmentOptionScore(prepared)
        : -4);
    }, 0);
  }, plan.confidence ?? 0);
}

function frontierAlignmentOptionScore(optionValue) {
  let score = 0;
  if (optionValue?.evidenceLabel && optionValue.evidenceLabel !== EVIDENCE_LIMITED_LABEL) score += 6;
  if (cleanText(optionValue?.description)) score += 3;
  if (optionValue?.evidenceLimited === true) score -= 2;
  if (optionValue?.antiSignal === true) score -= 1;
  if (cleanText(optionValue?.label).length >= 8) score += 1;
  return score;
}

function looksLikeContaminatedAlignmentChoice(value, dimension, plan) {
  const label = cleanSignalText(value);
  if (!label) return true;
  if (looksLikeInvalidCandidateText(label) || looksLikeOptionDocumentPointer(label) || hasBrokenGeneratedGrammar(label)) {
    return true;
  }
  if (dimension === "pain_point" && looksLikeProductInputArtifactPain(label)) {
    return true;
  }
  if (
    dimension === "outcome"
    && /(job\s*summary|motivation|frustration|persona|부트캠프|사용자\s*\d+명.*첫\s*매출|첫\s*매출\s*달성|사업\s*목표|제품\s*기능|기능\s*추가|feature|문서화|업로드)/i.test(label)
  ) {
    return true;
  }
  if (dimension === "outcome" && outcomeContainsKnownCustomerSegment(label, plan)) {
    return true;
  }
  const comparableLabel = comparableOptionText(label);
  return dimension === "outcome" && (
    comparableLabel === comparableOptionText(plan?.projectGoal)
    || comparableLabel === comparableOptionText(plan?.alignmentStatement?.painPoint)
  );
}

function looksLikeProductInputArtifactPain(value) {
  const text = cleanSignalText(value);
  if (!text) return false;
  if (hasPainCostSignal(text) && !/^\s*[-*]?\s*(?:problem\s*memo|interview\s*transcript|인터뷰\s*transcript)\s*(?:입력|업로드|등록)?\s*$/i.test(text)) {
    return false;
  }
  if (/(?:problem\s*memo|interview\s*transcript|인터뷰\s*transcript|transcript\s*(?:입력|업로드|등록|연결)|메모\s*(?:입력|업로드|등록))/i.test(text)) {
    return true;
  }
  const hasArtifact = /(?:problem\s*evidence|product[-_\s]?input|file[-_\s]?entry|schema|스키마|파일|문서|upload|업로드)/i.test(text);
  const hasProductFlow = /(?:입력|업로드|등록|연결|제출|import|attach|drop|upload|entry|file|schema)/i.test(text);
  return hasArtifact && hasProductFlow && !hasPainCostSignal(text);
}

function hasPainCostSignal(value) {
  return /(시간|돈|비용|리스크|위험|반복|수동|매번|매주|누락|실패|막힘|막혀|느림|오래|불편|어려움|모른|못|delay|risk|cost|manual|miss|missed|slow|stuck|repeat|repeated|struggle|friction)/i.test(cleanSignalText(value));
}

export function parseDay1IcpPlanText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export function normalizeDay1AlignmentPlan(value) {
  if (!value || typeof value !== "object") return null;

  const signals = normalizeSignals(value.signals);
  const projectGoal = cleanText(value.projectGoal || value.project_goal);
  const mission = cleanMultilineText(value.mission);
  const components = sanitizeNormalizedAlignmentComponents(
    normalizeAlignmentComponents(value.components),
    { signals, projectGoal },
  );
  const alignmentStatement = normalizeAlignmentStatement(
    value.alignmentStatement || value.alignment_statement,
    { projectGoal, components, signals },
  );
  const qualityGate = normalizeAlignmentQualityGate(
    value.qualityGate || value.quality_gate,
  );
  const firstInterviewMessage = normalizeFirstInterviewMessage(
    value.firstInterviewMessage || value.first_interview_message,
  );
  const day2Handoff = normalizeDay2Handoff(value.day2Handoff || value.day2_handoff);

  if (!signals || !projectGoal || !mission || !components || !alignmentStatement) return null;
  if (!qualityGate || !firstInterviewMessage || !day2Handoff) return null;

  const normalized = {
    schemaVersion: DAY1_ALIGNMENT_PLAN_SCHEMA_VERSION,
    source: cleanToken(value.source) || "deterministic",
    generatedAt: cleanText(value.generatedAt || value.generated_at),
    confidence: clampNumber(value.confidence, 0, 1, 0.5),
    fellBackToDeterministic: Boolean(value.fellBackToDeterministic || value.fell_back_to_deterministic),
    projectGoal,
    mission,
    signals,
    components,
    alignmentStatement,
    qualityGate,
    firstInterviewMessage,
    day2Handoff,
  };
  normalized.signalDigest = normalizeSignalDigest(value.signalDigest || value.signal_digest, normalized)
    || buildConciseSignalDigest(normalized);
  if (!alignmentPlanOptionsPassQualityAudit(normalized)) return null;
  return normalized;
}

function alignmentPlanOptionsPassQualityAudit(plan) {
  if (!plan?.components) return false;
  return [
    ["icp", plan.components.icp],
    ["pain_point", plan.components.painPoint],
    ["outcome", plan.components.outcome],
  ].every(([dimension, component]) => alignmentComponentOptionsPassQualityAudit(component, dimension, plan));
}

function alignmentComponentOptionsPassQualityAudit(component, dimension, plan) {
  const options = Array.isArray(component?.options) ? component.options : [];
  if (options.length < 2) return false;
  return options.every((optionValue) =>
    alignmentOptionPassesQualityAudit(optionValue, dimension, plan)
  );
}

function alignmentOptionPassesQualityAudit(optionValue, dimension, plan) {
  const label = cleanSignalText(optionValue?.label);
  if (!label) return false;
  if (optionValue?.evidenceLimited === true || label.startsWith("직접 입력") || label.startsWith("추가 scan 필요")) {
    return true;
  }
  if (looksLikeContaminatedAlignmentChoice(label, dimension, plan)) return false;
  if (dimension === "icp") {
    return optionValue?.antiSignal === true || looksLikeCustomerSegment(label);
  }
  if (dimension === "pain_point") {
    return !looksLikeProductInputArtifactPain(label);
  }
  if (dimension === "outcome") {
    return alignmentOutcomeOptionPassesQualityAudit(label, optionValue, plan);
  }
  return true;
}

function alignmentOutcomeOptionPassesQualityAudit(label, optionValue, plan) {
  if (optionValue?.antiSignal === true) return false;
  const comparableLabel = comparableOptionText(label);
  const comparableGoal = comparableOptionText(plan?.projectGoal);
  const comparablePain = comparableOptionText(plan?.alignmentStatement?.painPoint);
  if (comparableGoal && comparableLabel === comparableGoal) return false;
  if (comparablePain && comparableLabel === comparablePain) return false;
  if (outcomeContainsKnownCustomerSegment(label, plan)) return false;
  if (/부트캠프|사용자\s*\d+명.*첫\s*매출|첫\s*매출\s*달성.*목표|제품\s*기능|기능\s*추가|feature/i.test(label)) {
    return false;
  }
  return /(검증|확인|판단|행동|시장|신호|인터뷰|대화|증거|대안|지불|의향|도입|결정|정한다|반응|비용|리스크|risk|signal|interview|customer|market)/i.test(label);
}

function comparableOptionText(value) {
  return cleanSignalText(value)
    .replace(/[.。．]+$/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function looksLikeOptionDocumentPointer(value) {
  const text = cleanText(value);
  return /\.md\b/i.test(text)
    || /\[[^\]]+\]\([^)]+\)/.test(text)
    || /(?:docs\/|참고 문서|제품 명세와 타겟 사용자|제품 명세와 타깃 사용자|회사 미션|제품 매핑|루브릭|mapping|alignment)/i.test(text);
}

function hasBrokenGeneratedGrammar(value) {
  const text = cleanText(value);
  if (!text) return false;
  return /(검증로|한다\.로|모른다을|다로 이어지는|\.로 이어지는|을을|를를|수익\s*0원(?:의|가|\s+1명))/i.test(text)
    || hasUnbalancedGeneratedDelimiters(text);
}

function hasUnbalancedGeneratedDelimiters(value) {
  const stack = [];
  const pairs = new Map([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["（", "）"],
    ["［", "］"],
    ["｛", "｝"],
  ]);
  const openerForCloser = new Map([...pairs.entries()].map(([open, close]) => [close, open]));
  for (const char of String(value || "")) {
    const expectedClose = pairs.get(char);
    if (expectedClose) {
      stack.push(char);
      continue;
    }
    const expectedOpen = openerForCloser.get(char);
    if (!expectedOpen) continue;
    if (stack[stack.length - 1] !== expectedOpen) return true;
    stack.pop();
  }
  return stack.length > 0;
}

export function normalizeDay1IcpPlan(value) {
  if (!value || typeof value !== "object") return null;

  const signals = normalizeSignals(value.signals);
  const questions = normalizeQuestions(value.questions);
  const icpDraft = normalizeIcpDraft(value.icpDraft || value.icp_draft);
  const antiIcp = normalizeAntiIcp(value.antiIcp || value.anti_icp);
  const firstInterviewMessage = normalizeFirstInterviewMessage(
    value.firstInterviewMessage || value.first_interview_message,
  );
  const mission = cleanText(value.mission);

  if (!mission || !signals || questions.length < 3 || questions.length > 5) return null;
  if (!icpDraft || !antiIcp || !firstInterviewMessage) return null;

  return {
    schemaVersion: DAY1_ICP_PLAN_SCHEMA_VERSION,
    source: cleanToken(value.source) || "deterministic",
    generatedAt: cleanText(value.generatedAt || value.generated_at),
    confidence: clampNumber(value.confidence, 0, 1, 0.5),
    fellBackToDeterministic: Boolean(value.fellBackToDeterministic || value.fell_back_to_deterministic),
    mission,
    signals,
    questions,
    icpDraft,
    antiIcp,
    firstInterviewMessage,
  };
}

export function buildDay1IcpQuestionForDimensionForTesting(dimension, signals = {}) {
  const built = questionForDimension(dimension, signals);
  return normalizeQuestion({
    id: `q_test_${dimension}`,
    dimension,
    title: built.title,
    prompt: built.prompt,
    helperText: built.helperText,
    options: built.options,
    allowFreeText: true,
    freeTextPlaceholder: built.freeTextPlaceholder,
  }, 0);
}

async function collectDay1IcpEvidence({ workspaceRoot, scanResult, fsImpl }) {
  if (!workspaceRoot) return [];
  const root = path.resolve(workspaceRoot);
  const refs = [];

  await appendWorkspaceFileRefs(refs, {
    root,
    fsImpl,
    candidates: canonicalEvidenceCandidates(scanResult),
    maxRefs: MAX_EVIDENCE_REFS,
  });
  await appendWorkspaceFileRefs(refs, {
    root,
    fsImpl,
    candidates: [
      ["README.md", "readme"],
      ["readme.md", "readme"],
      ["README", "readme"],
      ["README.rst", "readme"],
    ],
    maxRefs: MAX_EVIDENCE_REFS,
  });

  const generalDocRefs = await collectDiscoveryFileRefs({
    root,
    fsImpl,
    existing: refs,
    directories: ["docs"],
    maxRefs: 3,
  });
  refs.push(...generalDocRefs.slice(0, Math.max(0, MAX_EVIDENCE_REFS - refs.length)));

  await appendWorkspaceFileRefs(refs, {
    root,
    fsImpl,
    candidates: packageConfigEvidenceCandidates(),
    maxRefs: MAX_EVIDENCE_REFS,
  });

  const discoveryRefs = await collectDiscoveryFileRefs({
    root,
    fsImpl,
    existing: refs,
    directories: [".agentic30", "interviews", "interview", "transcripts", "bip", "logs", "worklog", "notes"],
    maxRefs: 3,
  });
  refs.push(...discoveryRefs.slice(0, Math.max(0, MAX_EVIDENCE_REFS - refs.length)));

  const recentRefs = await collectRecentGitFileRefs({ root, fsImpl, existing: refs });
  refs.push(...recentRefs.slice(0, Math.max(0, MAX_EVIDENCE_REFS - refs.length)));

  const sourceRefs = await collectSourceEvidenceRefs({ root, fsImpl, existing: refs });
  refs.push(...sourceRefs.slice(0, Math.max(0, MAX_EVIDENCE_REFS - refs.length)));

  return uniqueBy(refs, (item) => item.path).slice(0, MAX_EVIDENCE_REFS);
}

function workspaceEvidenceRefToDay1Ref(ref = {}) {
  return {
    path: cleanText(ref.path),
    reason: cleanText(ref.reason || `${ref.role || "workspace"} signal`),
    quote: cleanText(ref.quote),
  };
}

function canonicalEvidenceCandidates(scanResult = {}) {
  const fromScan = Object.entries(scanResult || {})
    .filter(([, relative]) => typeof relative === "string" && relative.trim())
    .map(([role, relative]) => [relative, `${role} canonical_doc`]);
  return [
    ["docs/GOAL.md", "goal canonical_doc"],
    ["docs/ICP.md", "icp canonical_doc"],
    ["docs/SPEC.md", "spec canonical_doc"],
    ["docs/VALUES.md", "values canonical_doc"],
    ...fromScan,
  ];
}

function packageConfigEvidenceCandidates() {
  return [
    ["package.json", "manifest package_config"],
    ["pyproject.toml", "manifest package_config"],
    ["Cargo.toml", "manifest package_config"],
    ["go.mod", "manifest package_config"],
    ["Package.swift", "manifest package_config"],
    ["composer.json", "manifest package_config"],
    ["mix.exs", "manifest package_config"],
    ["Gemfile", "manifest package_config"],
  ];
}

async function appendWorkspaceFileRefs(refs, { root, fsImpl, candidates, maxRefs }) {
  const existingPaths = new Set(refs.map((item) => item.path));
  for (const [relativePath, reason] of candidates) {
    if (refs.length >= maxRefs) break;
    const normalizedPath = String(relativePath || "").trim();
    if (!normalizedPath || existingPaths.has(normalizedPath)) continue;
    const loaded = await readWorkspaceText({ root, relativePath: normalizedPath, fsImpl });
    if (!loaded || existingPaths.has(loaded.relativePath)) continue;
    refs.push({
      path: loaded.relativePath,
      reason,
      quote: evidenceQuote(loaded.content),
    });
    existingPaths.add(loaded.relativePath);
  }
}

async function collectDiscoveryFileRefs({
  root,
  fsImpl,
  existing,
  directories = ["interviews", "interview", "transcripts", "bip", "logs", "worklog", "notes", "docs"],
  maxRefs = 3,
}) {
  const existingPaths = new Set(existing.map((item) => item.path));
  const refs = [];
  for (const directory of directories) {
    let entries = [];
    try {
      entries = await fsImpl.readdir(path.join(root, directory), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (refs.length >= maxRefs) return refs;
      if (!entry.isFile()) continue;
      if (!/\.(md|mdx|txt|json)$/i.test(entry.name)) continue;
      const relativePath = path.posix.join(directory, entry.name);
      if (existingPaths.has(relativePath)) continue;
      const loaded = await readWorkspaceText({ root, relativePath, fsImpl, maxChars: 2400 });
      if (!loaded) continue;
      refs.push({
        path: loaded.relativePath,
        reason: `${directory} signal`,
        quote: evidenceQuote(loaded.content),
      });
    }
  }
  return refs;
}

async function collectRecentGitFileRefs({ root, fsImpl, existing }) {
  const recentFiles = await readRecentGitFileNames(root);
  const existingPaths = new Set(existing.map((item) => item.path));
  const refs = [];
  for (const relativePath of recentFiles) {
    if (refs.length >= 3) break;
    if (existingPaths.has(relativePath) || !isEvidenceFileCandidate(relativePath)) continue;
    const loaded = await readWorkspaceText({ root, relativePath, fsImpl, maxChars: 2400 });
    if (!loaded) continue;
    refs.push({
      path: loaded.relativePath,
      reason: "recent_git signal",
      quote: isSourceEvidenceCandidate(loaded.relativePath)
        ? sourceEvidenceQuote(loaded.content)
        : evidenceQuote(loaded.content),
    });
    existingPaths.add(loaded.relativePath);
  }
  return refs.filter((item) => item.quote);
}

function readRecentGitFileNames(root) {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let child;
    try {
      child = spawn("git", ["log", "--since=30.days", "--name-only", "--format="], {
        cwd: root,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve([]);
      return;
    }
    const settle = (value) => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* noop */ }
      resolve(value);
    };
    const timer = setTimeout(() => settle([]), 1500);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 12_000) settle([]);
    });
    child.on("error", () => {
      clearTimeout(timer);
      settle([]);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        settle([]);
        return;
      }
      settle(uniqueBy(
        output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => !line.includes("\0")),
        (item) => item,
      ).slice(0, 12));
    });
  });
}

async function collectSourceEvidenceRefs({ root, fsImpl, existing }) {
  const existingPaths = new Set(existing.map((item) => item.path));
  const candidates = await listSourceEvidenceCandidates({ root, fsImpl });
  const scored = [];
  for (const relativePath of candidates) {
    if (existingPaths.has(relativePath)) continue;
    const loaded = await readWorkspaceText({
      root,
      relativePath,
      fsImpl,
      maxChars: MAX_SOURCE_FILE_CHARS,
    });
    if (!loaded) continue;
    const score = sourceEvidenceScore(loaded.relativePath, loaded.content);
    if (score <= 0) continue;
    const quote = sourceEvidenceQuote(loaded.content);
    if (!quote) continue;
    scored.push({
      path: loaded.relativePath,
      reason: "source signal",
      quote,
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.slice(0, MAX_SOURCE_EVIDENCE_FILES).map(({ score, ...item }) => item);
}

async function listSourceEvidenceCandidates({ root, fsImpl }) {
  const results = [];
  await collectSourceEvidenceCandidatesInDir({ root, fsImpl, dirPath: root, results, depth: 0 });
  return results;
}

async function collectSourceEvidenceCandidatesInDir({ root, fsImpl, dirPath, results, depth }) {
  if (depth > 4 || results.length >= 80) return;
  let entries = [];
  try {
    entries = await fsImpl.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".agentic30") continue;
    if (SOURCE_EVIDENCE_DENY_SEGMENTS.has(entry.name)) continue;
    const entryPath = path.join(dirPath, entry.name);
    if (!isPathInsideRoot(root, entryPath)) continue;
    if (entry.isDirectory()) {
      await collectSourceEvidenceCandidatesInDir({ root, fsImpl, dirPath: entryPath, results, depth: depth + 1 });
    } else if (entry.isFile()) {
      const relativePath = path.relative(root, entryPath).split(path.sep).join(path.posix.sep);
      if (isSourceEvidenceCandidate(relativePath)) {
        results.push(relativePath);
        if (results.length >= 80) return;
      }
    }
  }
}

function isEvidenceFileCandidate(relativePath) {
  const normalized = String(relativePath || "");
  if (!normalized || normalized.includes("\0")) return false;
  return /\.(md|mdx|txt|json|toml|swift|ts|tsx|js|mjs|jsx|py|rs|go|kt|kts)$/i.test(normalized)
    && !hasDeniedEvidencePathSegment(normalized);
}

function isSourceEvidenceCandidate(relativePath) {
  const normalized = String(relativePath || "");
  if (!normalized || normalized.includes("\0")) return false;
  if (hasDeniedEvidencePathSegment(normalized)) return false;
  if (/\.(test|spec)\.[A-Za-z0-9]+$/i.test(normalized)) return false;
  if (/(^|[\\/])(__tests__|tests?|fixtures?)([\\/]|$)/i.test(normalized)) return false;
  if (/(^|[\\/])[^\\/]*(?:secret|token|credential|password|key)[^\\/]*($|[\\/])/i.test(normalized)) return false;
  return SOURCE_EVIDENCE_EXTENSIONS.has(path.extname(normalized));
}

function hasDeniedEvidencePathSegment(relativePath) {
  return String(relativePath || "")
    .split(/[\\/]+/)
    .some((part) => SOURCE_EVIDENCE_DENY_SEGMENTS.has(part));
}

function sourceEvidenceScore(relativePath, content) {
  const haystack = `${relativePath}\n${content}`;
  let score = 0;
  const matches = haystack.match(new RegExp(SOURCE_SIGNAL_PATTERN.source, "gi"));
  score += Math.min(matches?.length || 0, 12);
  if (/onboarding|landing|marketing|pricing|customer|user|goal|values?|mission|icp|persona/i.test(relativePath)) {
    score += 4;
  }
  return score;
}

function sourceEvidenceQuote(content) {
  const lines = extractSourceSignalLines(content)
    .map(userFacingSourceLine)
    .filter(Boolean)
    .slice(0, 5);
  return cleanText(lines.join(" / ")).slice(0, 420);
}

function extractSourceSignalLines(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && SOURCE_SIGNAL_PATTERN.test(line))
    .slice(0, MAX_SOURCE_SIGNAL_LINES);
}

function userFacingSourceLine(line) {
  const text = cleanSignalText(line)
    .replace(/^\s*(?:let|var|const|static\s+let|private\s+let|public\s+let)\s+[A-Za-z0-9_]+\s*[:=]\s*/i, "")
    .replace(/[{}[\]<>;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const label = cleanText(text.match(/^([A-Za-z0-9_]+)\s*[:=]/)?.[1] || "");
  const quoted = [...text.matchAll(/["'“”]([^"'“”]{8,180})["'“”]/g)]
    .map((match) => match[1]);
  const value = quoted.length ? quoted.join(" / ") : text;
  return cleanText(label ? `${label}: ${value}` : value).slice(0, 260);
}

function isPathInsideRoot(root, candidatePath) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidatePath);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

async function readWorkspaceText({ root, relativePath, fsImpl, maxChars = MAX_DOC_CHARS }) {
  if (typeof relativePath !== "string" || !relativePath.trim()) return null;
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) return null;
  const resolved = path.resolve(root, relativePath);
  if (!isPathInsideRoot(root, resolved)) return null;
  try {
    const stat = await fsImpl.stat(resolved);
    if (!stat.isFile() || stat.size > 2_000_000) return null;
    const content = await fsImpl.readFile(resolved, "utf8");
    return {
      relativePath: path.relative(root, resolved).split(path.sep).join(path.posix.sep),
      content: content.slice(0, maxChars),
    };
  } catch {
    return null;
  }
}

function buildDay1IcpSignals({
  workspaceRoot,
  scanResult,
  onboardingHypothesis,
  localDiscovery,
  evidence,
  workspaceEvidence = null,
}) {
  const h = onboardingHypothesis || {};
  const extracted = workspaceEvidence?.signals || {};
  const productName = normalizeUserFacingProjectName(h.productName)
    || normalizeUserFacingProjectName(extracted.productName)
    || inferProductName(workspaceRoot, evidence);
  const initialLikelyUsers = uniqueBy([
    ...normalizeStringArray(h.likelyUsers),
    ...normalizeStringArray(extracted.likelyUsers),
    extracted.targetUser,
  ].filter(Boolean), (item) => cleanText(item).toLowerCase()).slice(0, 5);
  const initialProblemCandidate = cleanCandidateText(h.problem) || cleanCandidateText(extracted.problem);
  const initialProblem = looksLikeProductInputArtifactPain(initialProblemCandidate) ? "" : initialProblemCandidate;
  const initialIcpGuess = cleanCandidateText(h.targetUser)
    || cleanCandidateText(extracted.targetUser)
    || initialLikelyUsers[0]
    || "";
  const evidenceText = evidenceContext(evidence);
  const currentAlternatives = inferCurrentAlternatives({
    projectKind: h.projectKind,
    context: evidenceText,
    localDiscovery,
  });
  const normalizedEvidence = evidence.map(normalizeEvidenceRef).filter(Boolean).slice(0, MAX_EVIDENCE_REFS);
  const evidenceBackedHypothesis = {
    ...h,
    productName,
    targetUser: cleanCandidateText(h.targetUser) || cleanCandidateText(extracted.targetUser),
    problem: initialProblem,
    purpose: cleanCandidateText(h.purpose) || cleanCandidateText(extracted.purpose),
    goal: cleanCandidateText(h.goal) || cleanCandidateText(extracted.goal),
    values: cleanCandidateText(h.values) || cleanCandidateText(extracted.values),
    likelyUsers: initialLikelyUsers,
    confidence: strongestSignalConfidence(h.confidence, workspaceEvidence?.confidence),
  };
  const evidenceBank = buildScanEvidenceBank({
    scanResult,
    onboardingHypothesis: evidenceBackedHypothesis,
    evidenceRefs: normalizedEvidence,
    currentAlternatives,
    localDiscovery,
  });
  const currentIcpGuess = initialIcpGuess || evidenceBank.targetUsers[0]?.value || "";
  const likelyUsers = uniqueBy([
    ...initialLikelyUsers,
    ...evidenceBank.targetUsers.map((candidate) => candidate.value),
  ].filter(Boolean), (item) => cleanText(item).toLowerCase()).slice(0, 5);
  const problem = initialProblem || evidenceBank.problems[0]?.value || "";
  const confidence = strongestSignalConfidence(
    h.confidence,
    workspaceEvidence?.confidence,
    inferSignalConfidence({ evidence, currentIcpGuess, problem }),
  );
  return {
    productName,
    currentIcpGuess,
    likelyUsers,
    problem,
    currentAlternatives,
    evidenceRefs: normalizedEvidence,
    missingAssumptions: inferMissingAssumptions({
      scanResult,
      currentIcpGuess,
      problem,
      evidence,
      confidence,
    }),
    confidence,
    evidenceBank,
  };
}

function strongestSignalConfidence(...values) {
  const rank = { low: 0, medium: 1, high: 2 };
  return values
    .map(cleanToken)
    .filter((value) => value === "low" || value === "medium" || value === "high")
    .sort((a, b) => rank[b] - rank[a])[0] || "low";
}

function buildScanEvidenceBank({
  scanResult = {},
  onboardingHypothesis = {},
  evidenceRefs = [],
  currentAlternatives = [],
  localDiscovery = null,
} = {}) {
  const h = onboardingHypothesis || {};
  const refs = normalizeEvidenceRefs(evidenceRefs);
  const roleRef = (role) => preferredRoleEvidenceRef(refs, scanResult, role);
  const defaultRef = preferredEvidenceRefs(refs)[0] || refs[0] || null;
  const context = [
    h.targetUser,
    h.problem,
    h.purpose,
    h.goal,
    h.values,
    ...(h.likelyUsers || []),
    ...(h.evidence || []),
    refs.map((ref) => `${ref.path} ${ref.reason} ${ref.quote}`).join("\n"),
  ].filter(Boolean).join("\n");
  const evidenceSignals = extractEvidenceSignals(refs);

  const icpRef = roleRef("icp") || defaultRef;
  const specRef = roleRef("spec") || defaultRef;
  const goalRef = roleRef("goal") || specRef || defaultRef;
  const docsRef = roleRef("docs") || defaultRef;

  const targetUsers = uniqueCandidates([
    evidenceCandidate(h.targetUser, icpRef, "target_user"),
    ...normalizeStringArray(h.likelyUsers).map((value) =>
      evidenceCandidate(value, icpRef || docsRef, "likely_user")
    ),
    ...evidenceSignals.targetUsers,
  ].filter((candidate) => candidate && looksLikeCustomerSegment(candidate.value)));

  const problems = uniqueCandidates([
    evidenceCandidate(h.problem, specRef, "problem"),
    ...problemCandidatesFromText(h.purpose || h.goal, specRef || goalRef),
    ...evidenceSignals.problems,
  ].filter((candidate) => candidate && !looksLikeProductInputArtifactPain(candidate.value)));

  const goals = uniqueCandidates([
    evidenceCandidate(h.goal, goalRef, "goal"),
    evidenceCandidate(h.purpose, goalRef || docsRef, "purpose"),
    ...evidenceSignals.goals,
  ].filter(Boolean));

  const alternatives = uniqueCandidates(
    normalizeStringArray(currentAlternatives)
      .filter((value) => !isEvidenceLimitedAlternative(value, context, localDiscovery))
      .map((value) => evidenceCandidate(value, evidenceRefForAlternative(value, refs, localDiscovery) || specRef || defaultRef, "alternative"))
      .filter(Boolean)
  );

  const buyerSignals = uniqueCandidates(buildBuyerSignalCandidates({ h, targetUsers, icpRef, defaultRef }));
  const successSignals = uniqueCandidates(buildSuccessSignalCandidates({
    h,
    context,
    targetUsers,
    goals,
    problems,
    goalRef,
    specRef,
  }).concat(evidenceSignals.outcomes));
  const paySignals = uniqueCandidates(buildPaySignalCandidates({
    h,
    context,
    alternatives,
    problems,
    goalRef,
    specRef,
    icpRef,
  }));
  const antiSignals = uniqueCandidates(buildAntiSignalCandidates({
    h,
    targetUsers,
    problems,
    alternatives,
    refs,
    defaultRef,
  }));
  const referenceCustomers = uniqueCandidates(buildReferenceCustomerCandidates({
    targetUsers,
    problems,
    icpRef,
    docsRef,
  }));

  return {
    targetUsers,
    problems,
    goals,
    alternatives,
    buyerSignals,
    successSignals,
    paySignals,
    antiSignals,
    referenceCustomers,
    defaultRef,
    hasEvidence: refs.length > 0 || targetUsers.length > 0 || problems.length > 0 || goals.length > 0,
  };
}

function preferredRoleEvidenceRef(refs, scanResult, role) {
  const rolePath = cleanText(scanResult?.[role]).toLowerCase();
  const roleName = cleanText(role).toLowerCase();
  return refs.find((ref) => rolePath && ref.path.toLowerCase() === rolePath)
    || refs.find((ref) => ref.reason.toLowerCase().startsWith(`${roleName} `))
    || refs.find((ref) => ref.path.toLowerCase().endsWith(`/${roleName}.md`))
    || null;
}

function extractEvidenceSignals(refs = []) {
  const output = {
    targetUsers: [],
    problems: [],
    goals: [],
    outcomes: [],
  };
  for (const ref of refs) {
    const normalizedRef = normalizeEvidenceRef(ref);
    if (!normalizedRef) continue;
    const role = evidenceRole(normalizedRef);
    for (const fragment of evidenceSignalFragments(normalizedRef.quote)) {
      const explicitGoal = labeledSignalValue(fragment, GOAL_SIGNAL_PATTERN);
      const explicitTarget = labeledSignalValue(fragment, ICP_SIGNAL_PATTERN);
      const explicitPain = labeledSignalValue(fragment, PAIN_SIGNAL_PATTERN);
      const explicitOutcome = labeledSignalValue(fragment, OUTCOME_SIGNAL_PATTERN);

      const goalValue = explicitGoal || (goalLikeSignal(fragment) ? fragment : "");
      const targetValue = explicitTarget
        || (ICP_SIGNAL_PATTERN.test(fragment) && looksLikeCustomerSegment(fragment) ? fragment : "")
        || (role === "icp" && looksLikeCustomerSegment(fragment) ? fragment : "");
      const painValue = explicitPain || (painLikeSignal(fragment) ? fragment : "");
      const outcomeValue = outcomeCandidateValue({
        fragment,
        explicitOutcome,
        role,
      });

      if (goalValue) output.goals.push(evidenceCandidate(goalValue, normalizedRef, "evidence_goal"));
      if (targetValue) output.targetUsers.push(evidenceCandidate(targetValue, normalizedRef, "evidence_target"));
      if (painValue && !looksLikeProductInputArtifactPain(painValue)) {
        output.problems.push(evidenceCandidate(painValue, normalizedRef, "evidence_problem"));
      }
      if (outcomeValue) output.outcomes.push(evidenceCandidate(outcomeValue, normalizedRef, "evidence_outcome"));
    }
  }
  return {
    targetUsers: uniqueCandidates(output.targetUsers).slice(0, 5),
    problems: uniqueCandidates(output.problems).slice(0, 5),
    goals: uniqueCandidates(output.goals).slice(0, 5),
    outcomes: uniqueCandidates(output.outcomes).slice(0, 5),
  };
}

function evidenceRole(ref) {
  const text = `${ref.reason || ""} ${ref.path || ""}`.toLowerCase();
  if (/goal|okr|north/.test(text)) return "goal";
  if (/icp|persona|customer|user|audience/.test(text)) return "icp";
  if (/spec|problem|pain|product/.test(text)) return "spec";
  if (/readme/.test(text)) return "readme";
  if (/source|recent_git/.test(text)) return "source";
  if (/manifest|package_config|package\.json/.test(text)) return "manifest";
  return "discovery";
}

function evidenceSignalFragments(value) {
  const text = cleanSignalText(value)
    .replace(/\s+\/\s+/g, "\n")
    .replace(/\s+\|\s+/g, "\n")
    .replace(/\s+[•·]\s+/g, "\n");
  return uniqueBy(
    text
      .split(/\r?\n|(?<=[.!?。])\s+/)
      .map((fragment) => fragment.trim())
      .filter((fragment) => fragment.length >= 8)
      .map((fragment) => conciseText(fragment, 180)),
    (item) => item.toLowerCase(),
  ).slice(0, 16);
}

function labeledSignalValue(fragment, pattern) {
  const text = cleanSignalText(fragment);
  if (!pattern.test(text)) return "";
  const labelMatch = text.match(/(?:goal|mission|purpose|success|north\s*star|proof\s*target|objective|customer|user|persona|audience|target|icp|problem|pain|friction|stuck|outcome|result|activation|validation|signal|목표|미션|목적|성공\s*기준|검증\s*목표|고객|사용자|페르소나|타깃|대상|문제|통증|막힘|결과|성공|검증|확인|신호)\s*(?:=|:|：|-|은|는)\s*["'“”]?([^"'“”\n]{6,180})/i);
  return cleanCandidateText(labelMatch?.[1] || text);
}

function outcomeCandidateValue({ fragment, explicitOutcome, role } = {}) {
  const candidate = explicitOutcome || (outcomeLikeSignal(fragment) ? fragment : "");
  if (!candidate) return "";
  return isUsableOutcomeSignal(candidate, { fragment, role }) ? candidate : "";
}

function goalLikeSignal(value) {
  const text = cleanText(value);
  return GOAL_SIGNAL_PATTERN.test(text) && !looksLikeDocumentPointer(text);
}

function painLikeSignal(value) {
  const text = cleanText(value);
  return PAIN_SIGNAL_PATTERN.test(text) && !looksLikeDocumentPointer(text);
}

function outcomeLikeSignal(value) {
  const text = cleanText(value);
  if (!isUsableOutcomeSignal(text)) return false;
  return OUTCOME_SIGNAL_PATTERN.test(text)
    && /(검증|확인|신호|대화|시장|인터뷰|반응|피드백|지불|의향|의사|대안|도입|결정|소개|최근\s*사건|validate|confirm|signal|activation|interview|conversation|feedback|alternative|willingness)/i.test(text)
    && !looksLikeDocumentPointer(text);
}

function isUsableOutcomeSignal(value, { fragment = value, role = "" } = {}) {
  const text = cleanSignalText(value);
  const sourceText = cleanSignalText(fragment);
  if (!text || looksLikeDocumentPointer(text) || looksLikeInvalidCandidateText(text)) return false;
  if (looksLikePersonaSummaryText(sourceText) || looksLikePersonaSummaryText(text)) return false;
  if (cleanToken(role) === "icp" && looksLikeProfileSummarySentence(sourceText || text)) return false;
  if (looksLikeBusinessGoalSummary(text)) return false;
  if (!hasConcreteOutcomeAction(text)) return false;
  if (/(?:약하다|두렵다|못한다|모른다|막혀\s*있다)[.。．]?$/i.test(text)) {
    return false;
  }
  return true;
}

function hasConcreteOutcomeAction(value) {
  return /(검증|확인|신호|대화|시장|인터뷰|반응|피드백|지불|의향|의사|대안|도입|결정|소개|최근\s*사건|validate|confirm|signal|activation|interview|conversation|feedback|alternative|willingness)/i.test(cleanSignalText(value));
}

function looksLikePersonaSummaryText(value) {
  const text = cleanSignalText(value);
  if (!text) return false;
  return /^\s*[-*]?\s*(?:\*\*)?(?:job\s+summary|motivation|frustration|persona|primary\s+persona)\b/i.test(text)
    || /^\s*[-*]?\s*(?:\*\*)?(?:직무\s*요약|동기|불만|페르소나)\b/i.test(text);
}

function looksLikeProfileSummarySentence(value) {
  const text = cleanSignalText(value);
  if (!text) return false;
  return /(?:빠르게|빨리|만들\s*수\s*있지만|사용하지만).*(?:약하다|두렵다|못한다|모른다|막혀\s*있다)/i.test(text)
    || /(?:job\s+summary|motivation|frustration|persona)/i.test(text);
}

function looksLikeBusinessGoalSummary(value) {
  const text = cleanSignalText(value);
  if (!text) return false;
  const hasValidationAction = /(대화|인터뷰|현재\s*대안|지불\s*의향|최근\s*사건|고객\s*반응|구체\s*피드백|도입\s*결정|소개|conversation|interview|feedback|alternative|willingness)/i.test(text);
  if (hasValidationAction) return false;
  return /(?:목표|목표로\s*한다|달성|30일|사용자\s*\d+\s*명|첫\s*매출|revenue|business\s*goal)/i.test(text);
}

function evidenceCandidate(value, evidenceRef = null, source = "") {
  const text = cleanCandidateText(value);
  if (!text) return null;
  const normalizedRef = normalizeEvidenceRef(evidenceRef);
  return {
    value: text,
    evidenceRef: normalizedRef,
    evidenceLabel: scanEvidenceLabel(normalizedRef) || "근거: onboarding scan",
    source: cleanToken(source),
    evidenceLimited: false,
  };
}

function limitedCandidate(value, source = "fallback") {
  const text = cleanCandidateText(value);
  if (!text) return null;
  return {
    value: text,
    evidenceRef: null,
    evidenceLabel: EVIDENCE_LIMITED_LABEL,
    source: cleanToken(source),
    evidenceLimited: true,
  };
}

function cleanCandidateText(value, max = 110) {
  const text = cleanSignalText(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/\s+[—-]\s+$/g, "")
    .replace(/[,;]+$/g, "")
    .trim();
  if (!text || looksLikeDocumentPointer(text)) return "";
  if (looksLikeInvalidCandidateText(text)) return "";
  return conciseText(text, max);
}

function firstCleanCandidate(values = [], max = 110) {
  for (const value of values) {
    const cleaned = cleanCandidateText(value, max);
    if (cleaned) return cleaned;
  }
  return "";
}

function looksLikeInvalidCandidateText(value) {
  const text = cleanSignalText(value);
  if (!text) return true;
  if (/^[\d\s,./:;+-]+$/.test(text)) return true;
  if (/\bz\.[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(text)) return true;
  if (/\b(?:zod|schema|enum|literal|object|array|optional|passthrough)\b/i.test(text) && /[().{}[\],:]/.test(text)) {
    return true;
  }
  if (/^(?:true|false|null|undefined|NaN)$/i.test(text)) return true;
  return false;
}

function looksLikeDocumentPointer(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return true;
  return /\.md\b/.test(text) && /(루브릭|문서|매핑|mapping|alignment|company|회사|docs?)/i.test(text);
}

function looksLikeCustomerSegment(value) {
  const text = cleanText(value);
  if (!text || looksLikeDocumentPointer(text)) return false;
  return /(고객|사용자|사람|팀|개발자|창업자|운영자|담당자|대표|리드|lead|manager|founder|developer|customer|user|team|persona|operator|owner)/i.test(text);
}

function problemCandidatesFromText(value, evidenceRef) {
  const text = cleanSignalText(value);
  if (!text) return [];
  const matches = [];
  for (const pattern of [
    /Problem:\s*([^.\n]+)/i,
    /문제[:：]\s*([^.\n]+)/i,
    /pain[:：]\s*([^.\n]+)/i,
  ]) {
    const match = text.match(pattern);
    if (match?.[1]) matches.push(evidenceCandidate(match[1], evidenceRef, "problem"));
  }
  return matches;
}

function buildBuyerSignalCandidates({ h, targetUsers, icpRef, defaultRef }) {
  const text = [
    h.targetUser,
    h.stage,
    ...(h.likelyUsers || []),
    ...(h.evidence || []),
  ].join("\n").toLowerCase();
  const ref = icpRef || defaultRef;
  const candidates = [];
  if (/1인|solo|founder|indie|전업|개인|개발자/.test(text)) {
    candidates.push(evidenceCandidate("사용자 본인이 바로 결정하고 도입할 수 있는 고객", ref, "buyer_user"));
  }
  if (/b2b|lead|manager|팀|조직|support|sales|cs|담당자|리드/.test(text)) {
    candidates.push(evidenceCandidate("사용자는 강하지만 팀 리드/대표 승인 흐름을 확인해야 하는 고객", ref, "buyer_user"));
  }
  for (const target of targetUsers.slice(0, 2)) {
    candidates.push(evidenceCandidate(`${target.value} 본인이 이번 주 테스트를 결정할 수 있음`, target.evidenceRef || ref, "buyer_user"));
  }
  return candidates.filter(Boolean);
}

function buildSuccessSignalCandidates({ h = {}, context = "", targetUsers = [], goals, problems, goalRef, specRef }) {
  const candidates = [];
  const problem = outcomeProblemFragment(problems[0]?.value || h.problem);
  const goalText = cleanSignalText(h.goal || goals[0]?.value || h.purpose || "");
  const lowerContext = `${goalText}\n${context}`.toLowerCase();
  const primaryRef = problems[0]?.evidenceRef || specRef || goalRef;
  const goalEvidenceRef = goals[0]?.evidenceRef || goalRef || primaryRef;

  if (/유료|매출|결제|가격|pricing|paid|revenue|money|\$|₩|원/.test(lowerContext)) {
    candidates.push(evidenceCandidate(
      "지불 의향과 현재 대안을 다음 시장 신호 확인에서 검증한다",
      goalEvidenceRef,
      "success_signal",
    ));
  }
  if (problem) {
    candidates.push(evidenceCandidate(
      `"${problem}" 상황을 이번 주 고객 대화에서 확인한다`,
      primaryRef,
      "success_signal",
    ));
  }
  if (/사용자|user|고객|interview|인터뷰|파일럿|pilot|시장/.test(lowerContext)) {
    candidates.push(evidenceCandidate(
      "최근 사건과 첫 사용자 획득 대안을 확인한다",
      goalEvidenceRef,
      "success_signal",
    ));
  }
  if (candidates.length === 0) {
    candidates.push(evidenceCandidate(
      "다음 인터뷰에서 확인할 시장 신호를 정한다",
      goalEvidenceRef,
      "success_signal",
    ));
  }
  return candidates.filter(Boolean);
}

function buildPaySignalCandidates({ h, context, alternatives, problems, goalRef, specRef, icpRef }) {
  const lower = String(context || "").toLowerCase();
  const candidates = [];
  if (/유료|매출|결제|가격|pricing|paid|revenue|money|\$|₩|원/.test(lower)) {
    candidates.push(evidenceCandidate("유료 고객/매출/가격 검증 신호가 scan에 있음", goalRef || specRef, "pay_signal"));
  }
  for (const alternative of alternatives.slice(0, 2)) {
    candidates.push(evidenceCandidate(`${alternative.value}에 이미 시간이나 비용을 쓰는 고객`, alternative.evidenceRef || specRef, "pay_signal"));
  }
  for (const problem of problems.slice(0, 1)) {
    candidates.push(evidenceCandidate(`${problem.value} 실패가 시간·돈·리스크 비용으로 이어짐`, problem.evidenceRef || specRef, "pay_signal"));
  }
  if (/pre_revenue|수익\s*0|첫\s*매출|0원/.test(`${h.stage || ""}\n${context}`.toLowerCase())) {
    candidates.push(evidenceCandidate("아직 수익/지불 근거가 약해 가격 검증이 필요한 고객", icpRef || goalRef || specRef, "pay_signal"));
  }
  return candidates.filter(Boolean);
}

function buildAntiSignalCandidates({ h, targetUsers, problems, alternatives, refs, defaultRef }) {
  const candidates = [];
  const ref = defaultRef || refs[0] || null;
  if (!problems.length) {
    candidates.push(limitedCandidate("핵심 문제 근거가 scan에서 비어 있는 후보", "anti_signal"));
  }
  if (!alternatives.length) {
    candidates.push(limitedCandidate("현재 대안이나 반복 행동 근거가 없는 후보", "anti_signal"));
  }
  if (!targetUsers.length) {
    candidates.push(limitedCandidate("고객 세그먼트 근거가 문서에서 확인되지 않는 후보", "anti_signal"));
  }
  const text = [h.targetUser, h.problem, h.goal, ...(h.evidence || [])].join("\n");
  if (/관심|좋네요|흥미|언젠가|나중에|curious|interesting/i.test(text)) {
    candidates.push(evidenceCandidate("최근 사건 없이 관심만 보이는 후보", ref, "anti_signal"));
  }
  return candidates.filter(Boolean);
}

function buildReferenceCustomerCandidates({ targetUsers, problems, icpRef, docsRef }) {
  const candidates = [];
  for (const target of targetUsers.slice(0, 3)) {
    const problem = problems[0]?.value;
    const label = problem
      ? `${target.value} 중 ${problem}을 최근 직접 말한 1명`
      : `${target.value} 중 이번 주 20분 인터뷰 가능한 1명`;
    candidates.push(evidenceCandidate(label, target.evidenceRef || icpRef || docsRef, "reference_customer"));
  }
  return candidates.filter(Boolean);
}

function evidenceRefForAlternative(label, refs, localDiscovery) {
  const text = cleanText(label).toLowerCase();
  if (/github|ide|cli|터미널|에디터|스크립트|sdk/.test(text)) {
    return refs.find((ref) => ref.path === "package.json")
      || refs.find((ref) => /^readme\.md$/i.test(ref.path))
      || (localDiscovery?.project?.stacks?.length ? { path: "localDiscovery.project.stacks", reason: "workspace stack scan", quote: localDiscovery.project.stacks.join(", ") } : null);
  }
  if (/slack|메일|email|gmail|support/.test(text)) {
    return refs.find((ref) => /spec|readme|icp/i.test(`${ref.path} ${ref.reason} ${ref.quote}`));
  }
  if (/notion|spreadsheet|sheet|csv|airtable|문서/.test(text)) {
    return refs.find((ref) => /docs?|sheet|readme|spec/i.test(`${ref.path} ${ref.reason}`));
  }
  return refs[0] || null;
}

function isEvidenceLimitedAlternative(label, context, localDiscovery) {
  const text = cleanText(label);
  if (!text) return true;
  if (/아직 명확한 대안 없이|범용 AI\/검색\/문서 도구/.test(text)) return true;
  const lower = `${context || ""}\n${(localDiscovery?.project?.stacks || []).join("\n")}`.toLowerCase();
  if (/github|ide|cli|터미널|에디터|스크립트|sdk/.test(text.toLowerCase())) {
    return !/(github|ide|cli|sdk|developer|node|swift|typescript|javascript|python)/.test(lower);
  }
  return false;
}

function uniqueCandidates(candidates) {
  return uniqueBy(
    candidates.filter(Boolean),
    (candidate) => cleanText(candidate.value).toLowerCase()
  );
}

function scanEvidenceLabel(ref) {
  const normalized = normalizeEvidenceRef(ref);
  if (!normalized?.path) return "";
  return `근거: ${normalized.path}`;
}

function buildMission(signals) {
  const product = signals.productName || "이 프로젝트";
  const target = signals.currentIcpGuess || "잠재 고객";
  const problem = signals.problem || USER_FACING_GENERIC_PROBLEM;
  return `${product}의 ICP v0를 PostHog식으로 좁힙니다. ${target}라는 가설을 need / have / don't need 기준으로 검증 가능하게 만들고, "${problem}"을 실제로 겪는 reference customer를 찾을 질문과 docs/ICP.md 초안을 만듭니다.`;
}

function buildProjectGoal({ signals, onboardingHypothesis, evidence }) {
  const h = onboardingHypothesis || {};
  const explicitGoal = firstCleanCandidate([h.goal, h.businessGoal, h.business_goal], 140);
  if (explicitGoal) return explicitGoal;
  const evidenceGoal = signals?.evidenceBank?.goals?.[0]?.value;
  if (evidenceGoal) return evidenceGoal;
  const purposeGoal = firstCleanCandidate([h.purpose], 140);
  if (purposeGoal) return purposeGoal;

  const product = signals.productName || "이 프로젝트";
  const hasSpecificTarget = Boolean(signals.currentIcpGuess || signals.likelyUsers?.[0]);
  const hasSpecificProblem = Boolean(signals.problem);
  if (!hasSpecificTarget && !hasSpecificProblem) {
    return "목표 확인 필요";
  }
  const problem = signals.problem || "현재 가장 큰 고객 문제";
  const target = signals.currentIcpGuess || signals.likelyUsers?.[0] || "첫 고객 후보";
  const hasUserFacingEvidence = (evidence || []).some(isUserFacingEvidenceRef);
  if (!hasUserFacingEvidence) {
    return "목표 확인 필요";
  }
  return `${product}가 ${target}의 "${problem}" 해결을 검증할 첫 고객 증거를 만든다.`;
}

function buildAlignmentMission() {
  return "Day 1 — 만들기 전에, 팔릴 문제를 고릅니다.\n오늘은 코딩하지 않습니다.\n30일 동안 검증할 고객, 문제, 첫 결제 이유를 한 문장으로 정합니다.";
}

function buildAlignmentComponents({ signals, projectGoal }) {
  const target = signals.currentIcpGuess || signals.likelyUsers?.[0] || "아직 좁히는 중인 첫 고객 후보";
  const hasSpecificProblem = Boolean(signals.problem);
  const problem = signals.problem || USER_FACING_GENERIC_PAIN_POINT;
  const outcome = buildOutcomeStatement({ signals, projectGoal });
  const evidence = (signals.evidenceRefs || []).map((ref) => `${ref.path}: ${ref.reason || "workspace evidence"}`);
  const bank = scanEvidenceBankForSignals(signals);

  return {
    icp: {
      id: "icp",
      title: "고객",
      prompt: "이 목표를 검증하려면 이번 주 가장 먼저 확인할 고객 후보는 누구인가요?",
      helperText: "직함보다 지금 같은 문제를 겪고, 이번 주 실제로 물어볼 수 있는 고객 조건을 고릅니다.",
      statement: hasSpecificProblem
        ? `${target} 중 "${problem}" 상황을 지금 해결하려는 고객.`
        : `${target} 중 이번 주 가장 먼저 확인할 고객.`,
      evidence,
      missingAssumptions: signals.currentIcpGuess ? [] : ["current_icp"],
      options: buildAlignmentIcpOptions(bank),
    },
    painPoint: {
      id: "pain_point",
      title: "문제",
      prompt: "이 고객이 지금 겪는 가장 압축된 문제는 무엇인가요?",
      helperText: "좋으면 쓰는 문제가 아니라 시간, 돈, 리스크, 반복 행동으로 이미 비용이 나는 문제여야 합니다.",
      statement: problem,
      evidence,
      missingAssumptions: signals.problem ? [] : ["pain_point"],
      options: buildAlignmentPainOptions(bank),
    },
    outcome: {
      id: "outcome",
      title: "확인할 행동",
      prompt: "그 고객에게서 어떤 행동 신호를 확인해야 하나요?",
      helperText: "제품 기능이 아니라 지불 의향, 현재 대안, 최근 사건처럼 관찰 가능한 행동을 씁니다.",
      statement: outcome,
      evidence,
      missingAssumptions: outcome ? [] : ["outcome"],
      options: buildAlignmentOutcomeOptions(bank, outcome, projectGoal),
    },
  };
}

function buildOutcomeStatement({ signals, projectGoal }) {
  const evidenceOutcome = firstCleanCandidate([
    ...(signals?.evidenceBank?.successSignals || [])
      .filter((candidate) => candidate?.source === "evidence_outcome")
      .map((candidate) => candidate.value),
    signals?.evidenceBank?.successSignals?.[0]?.value,
  ], 110);
  if (evidenceOutcome) {
    return sentenceWithPeriod(sanitizeOutcomeActionText(evidenceOutcome, { signals }));
  }
  const problem = outcomeProblemFragment(signals.problem || "");
  if (problem) {
    return `"${problem}" 상황을 이번 주 고객 대화와 시장 신호로 확인한다.`;
  }
  if (!signals.currentIcpGuess && !(signals.likelyUsers?.length)) {
    return "다음 시장 신호 확인에서 검증할 고객 행동을 정한다.";
  }
  const goalFocus = outcomeGoalFragment(projectGoal);
  if (goalFocus) {
    return `${goalFocus} 기준으로 검증할 고객 행동과 시장 신호를 정한다.`;
  }
  return "이번 주 인터뷰/시장 검증에서 확인할 행동 신호를 정한다.";
}

function sentenceWithPeriod(value) {
  const text = cleanSignalText(value).replace(/[.。．]+$/u, "").trim();
  return text ? `${text}.` : "";
}

function buildAlignmentStatement({ projectGoal, components }) {
  const icp = components.icp.statement;
  const painPoint = components.painPoint.statement;
  const outcome = components.outcome.statement;
  return {
    statement: `목표: ${projectGoal} / 고객: ${icp} / 문제: ${painPoint} / 확인할 행동: ${outcome}`,
    projectGoal,
    icp,
    painPoint,
    outcome,
  };
}

function buildAlignmentQualityGate({ projectGoal, signals, components, evidence }) {
  const evidenceScore = alignmentEvidenceScore(evidence || []);
  const outcomeDuplicatesPain = comparableOptionText(components.outcome.statement)
    === comparableOptionText(components.painPoint.statement);
  const criteria = [
    qualityCriterion({
      id: "project_goal",
      label: "목표",
      maxScore: 2,
      score: isHighQualityAlignmentText("goal", projectGoal) ? 2 : 0.5,
      detail: projectGoal || "프로젝트 목표가 비어 있습니다.",
    }),
    qualityCriterion({
      id: "icp",
      label: "고객",
      maxScore: 2.5,
      score: isHighQualityAlignmentText("icp", signals.currentIcpGuess)
        ? 2.5
        : signals.likelyUsers?.some((value) => isHighQualityAlignmentText("icp", value)) ? 1.5 : 0.5,
      detail: components.icp.statement,
    }),
    qualityCriterion({
      id: "pain_point",
      label: "문제",
      maxScore: 2,
      score: isHighQualityAlignmentText("pain", signals.problem) ? 2 : 0.5,
      detail: components.painPoint.statement,
    }),
    qualityCriterion({
      id: "outcome",
      label: "확인할 행동",
      maxScore: 2,
      score: !outcomeDuplicatesPain && isHighQualityAlignmentText("outcome", components.outcome.statement) ? 2 : 0.5,
      detail: components.outcome.statement,
    }),
    qualityCriterion({
      id: "evidence",
      label: "근거",
      maxScore: 1.5,
      score: evidenceScore.score,
      detail: evidence?.length
        ? `${evidenceScore.detail}: ${evidence.map((item) => item.path).slice(0, 3).join(", ")}`
        : "근거 문서를 찾지 못했습니다.",
    }),
  ];
  const score = roundNumber(criteria.reduce((sum, item) => sum + item.score, 0), 1);
  const passed = score >= DAY1_ALIGNMENT_QUALITY_GATE_THRESHOLD;
  return {
    score,
    threshold: DAY1_ALIGNMENT_QUALITY_GATE_THRESHOLD,
    passed,
    label: passed ? "PASS" : "REWORK",
    passGate: "목표, 고객, 문제, 확인할 행동이 담긴 핵심 가설이 7.0/10 이상이고 Day 2 시장 신호로 넘길 한 문장이 있다.",
    failGate: "목표, 고객, 문제, 확인할 행동 중 하나가 비어 있거나 founder 추측만 있고 Day 2에서 확인할 시장 신호가 없다.",
    criteria,
  };
}

function qualityCriterion({ id, label, score, maxScore, detail }) {
  const normalizedScore = roundNumber(clampNumber(score, 0, maxScore, 0), 1);
  const normalizedMax = roundNumber(maxScore, 1);
  return {
    id,
    label,
    score: normalizedScore,
    maxScore: normalizedMax,
    passed: normalizedScore >= normalizedMax * 0.7,
    detail: cleanText(detail),
  };
}

function buildDay2Handoff({ signals, projectGoal, alignmentStatement, qualityGate }) {
  const product = signals.productName || "이 프로젝트";
  return {
    title: "Day 2 시장 신호로 넘길 핵심 가설",
    body: `${product}의 Day 2는 이 핵심 가설을 기준으로 유료 대체재, 반복 표현, 반증 신호를 찾습니다.`,
    focus: alignmentStatement.statement,
    nextDayPrompt: `${projectGoal} 목표에 맞춰 "${signals.problem || "핵심 문제"}"가 실제 시장에서 돈/시간을 쓰는 문제인지 확인한다.`,
    qualityGateLabel: `${qualityGate.label} ${qualityGate.score}/10`,
  };
}

function buildConciseSignalDigest(plan) {
  const product = firstUsableSignalDigestValue("project", [
    plan?.signals?.productName,
    "이 프로젝트",
  ], plan);
  const projectValue = product;
  const goal = firstUsableSignalDigestValue("goal", [
    firstSentence(plan?.projectGoal),
    plan?.projectGoal,
    "목표 확인 필요",
  ], plan);
  const icp = firstUsableSignalDigestValue("icp", [
    plan?.signals?.currentIcpGuess,
    plan?.alignmentStatement?.icp,
    plan?.signals?.likelyUsers?.[0],
    "첫 고객 후보 확인 필요",
  ], plan);
  const pain = firstUsableSignalDigestValue("pain", [
    plan?.signals?.problem,
    plan?.alignmentStatement?.painPoint,
    "핵심 문제 확인 필요",
  ], plan);
  const outcome = firstUsableSignalDigestValue("outcome", [
    conciseOutcome({ signals: plan?.signals, alignmentStatement: plan?.alignmentStatement }),
    "첫 검증 행동",
  ], plan);
  const evidence = conciseText(
    preferredEvidenceRefs(plan?.signals?.evidenceRefs).map((item) => item.path).join(", ") || "evidence 없음",
    SIGNAL_DIGEST_VALUE_LIMITS.evidence,
  );
  const summary = conciseText(
    `${product}: "${sentenceFragment(pain, 52)}"를 Day 2 검증 기준으로 넘깁니다.`,
    160,
  );

  return {
    schemaVersion: DAY1_SIGNAL_DIGEST_SCHEMA_VERSION,
    rows: [
      { key: "project", label: signalDigestLabel("project"), value: projectValue, tone: "strong" },
      { key: "goal", label: signalDigestLabel("goal"), value: goal, tone: "body" },
      { key: "icp", label: signalDigestLabel("icp"), value: icp, tone: "body" },
      { key: "pain", label: signalDigestLabel("pain"), value: pain, tone: "mark" },
      { key: "outcome", label: signalDigestLabel("outcome"), value: outcome, tone: "strong" },
      { key: "evidence", label: signalDigestLabel("evidence"), value: evidence, tone: "code" },
    ],
    summary,
  };
}

function normalizeSignalDigest(value, plan = null) {
  const parsed = Day1SignalDigestSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    schemaVersion: DAY1_SIGNAL_DIGEST_SCHEMA_VERSION,
    rows: parsed.data.rows.map((row) => ({
      key: row.key,
      label: signalDigestLabel(row.key, row.label),
      value: sanitizeSignalDigestRowValue(row.key, row.value, plan),
      tone: cleanToken(row.tone),
    })),
    summary: cleanText(parsed.data.summary),
  };
}

function sanitizeSignalDigestRowValue(key, value, plan = null) {
  if (key === "evidence") {
    return conciseText(value, SIGNAL_DIGEST_VALUE_LIMITS.evidence) || "evidence 없음";
  }
  const cleaned = key === "outcome"
    ? sanitizeOutcomeActionText(cleanDigestDisplayText(value), plan)
    : cleanDigestDisplayText(value);
  if (cleaned
      && !looksLikeSignalDigestDocumentReference(value, cleaned)
      && isHighQualityAlignmentText(key, cleaned)) {
    const normalized = conciseSignalDigestValue(key, cleaned);
    if (normalized) return normalized;
  }
  return fallbackSignalDigestValue(key, plan);
}

function signalDigestLabel(key, fallback = "") {
  return SIGNAL_DIGEST_LABELS[key] || cleanText(fallback) || "항목";
}

function fallbackSignalDigestValue(key, plan = null) {
  switch (key) {
    case "project":
      return firstUsableSignalDigestValue("project", [plan?.signals?.productName, "이 프로젝트"], plan);
    case "goal":
      return firstUsableSignalDigestValue("goal", [firstSentence(plan?.projectGoal), plan?.projectGoal, "목표 확인 필요"], plan);
    case "icp":
      return firstUsableSignalDigestValue("icp", [
        plan?.signals?.currentIcpGuess,
        plan?.alignmentStatement?.icp,
        plan?.signals?.likelyUsers?.[0],
        "첫 고객 후보 확인 필요",
      ], plan);
    case "pain":
      return firstUsableSignalDigestValue("pain", [plan?.signals?.problem, plan?.alignmentStatement?.painPoint, "핵심 문제 확인 필요"], plan);
    case "outcome":
      return firstUsableSignalDigestValue("outcome", [
        plan?.alignmentStatement?.outcome,
        conciseOutcome({ signals: plan?.signals, alignmentStatement: plan?.alignmentStatement }),
        "첫 검증 행동",
      ], plan);
    default:
      return "확인 필요";
  }
}

function firstUsableSignalDigestValue(key, candidates = [], plan = null) {
  for (const candidate of candidates) {
    const cleaned = key === "outcome"
      ? sanitizeOutcomeActionText(cleanDigestDisplayText(candidate), plan)
      : cleanDigestDisplayText(candidate);
    if (!cleaned || looksLikeSignalDigestDocumentReference(candidate, cleaned)) continue;
    if (key === "outcome" && outcomeContainsKnownCustomerSegment(cleaned, plan)) continue;
    if (!isHighQualityAlignmentText(key, cleaned)) continue;
    const normalized = conciseSignalDigestValue(key, cleaned);
    if (normalized) return normalized;
  }
  return conciseSignalDigestValue(key, placeholderSignalDigestValue(key));
}

function placeholderSignalDigestValue(key) {
  switch (key) {
  case "project":
    return "이 프로젝트";
  case "goal":
    return "목표 확인 필요";
  case "icp":
    return "첫 고객 후보 확인 필요";
  case "pain":
    return "핵심 문제 확인 필요";
  case "outcome":
    return "첫 검증 행동";
  default:
    return "확인 필요";
  }
}

function conciseSignalDigestValue(key, value) {
  const limit = SIGNAL_DIGEST_VALUE_LIMITS[key] || 120;
  if (key === "project") return conciseText(normalizeProjectDigestValue(value), limit);
  return conciseText(value, limit);
}

function cleanDigestDisplayText(value) {
  return cleanSignalText(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .trim();
}

function looksLikeSignalDigestDocumentReference(rawValue, cleanedValue = rawValue) {
  const raw = cleanText(rawValue);
  const text = cleanText(cleanedValue);
  if (!text) return true;
  if (/\[[^\]]*\.md[^\]]*\]\([^)]+\)/i.test(raw)) return true;
  if (/^(?:\.\/)?(?:docs\/)?[a-z0-9._/-]+\.md(?:#[a-z0-9._-]+)?$/i.test(text)) return true;
  return /\.md\b/i.test(text)
    && /(문서|매핑|루브릭|reference|참고|company|회사|source|docs?|alignment)/i.test(text);
}

function normalizeProjectDigestValue(value) {
  const text = cleanDigestDisplayText(value);
  const parts = text.split(/\s+·\s+/);
  const product = parts.find((part) => !/^quality\b/i.test(part.trim())) || parts[0] || text;
  return normalizeUserFacingProjectName(product);
}

function conciseOutcome({ signals, alignmentStatement } = {}) {
  const raw = sanitizeOutcomeActionText(alignmentStatement?.outcome, { signals, alignmentStatement });
  const goalLeak = cleanSignalText(alignmentStatement?.projectGoal);
  if (raw && raw.length <= SIGNAL_DIGEST_VALUE_LIMITS.outcome && (!goalLeak || !raw.includes(goalLeak))) {
    return raw;
  }
  const pain = twoClauseFragment(signals?.problem || alignmentStatement?.painPoint || "핵심 문제", 64);
  return `${pain} 확인 → 첫 검증 행동`;
}

function preferredEvidenceRefs(evidenceRefs = []) {
  const refs = normalizeEvidenceRefs(evidenceRefs);
  const ranked = refs.map((item, index) => ({ item, index, rank: evidenceDisplayRank(item.path) }));
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return uniqueBy(ranked.map((entry) => entry.item), (item) => item.path.toLowerCase()).slice(0, 3);
}

function evidenceDisplayRank(refPath) {
  const normalized = cleanText(refPath).toLowerCase();
  if (normalized === "docs/goal.md") return 0;
  if (normalized === "docs/icp.md") return 1;
  if (normalized === "docs/spec.md") return 2;
  if (normalized === "docs/values.md") return 3;
  if (normalized.startsWith("docs/")) return 4;
  if (/^readme\.md$/i.test(normalized)) return 5;
  if (normalized === "package.json") return 6;
  return 7;
}

function scanEvidenceBankForSignals(signals = {}) {
  return signals.evidenceBank || buildScanEvidenceBank({
    evidenceRefs: signals.evidenceRefs || [],
    currentAlternatives: signals.currentAlternatives || [],
    onboardingHypothesis: {
      targetUser: signals.currentIcpGuess,
      likelyUsers: signals.likelyUsers,
      problem: signals.problem,
      confidence: signals.confidence,
    },
  });
}

function buildAlignmentIcpOptions(bank) {
  const options = bank.targetUsers.slice(0, 3).map((candidate) =>
    alignmentOptionFromCandidate(
      candidate,
      "",
      "고객",
    )
  );
  return ensureEvidenceBackedOptions(options, {
    fallbackLabel: "직접 입력: scan보다 더 정확한 고객 후보",
    fallbackDescription: "고객 후보 근거가 부족하면 한 줄로 보정합니다.",
    fallbackPreview: "직접 입력",
  });
}

function buildAlignmentPainOptions(bank) {
  const options = bank.problems
    .filter((candidate) => !looksLikeProductInputArtifactPain(candidate.value))
    .slice(0, 3)
    .map((candidate) =>
      alignmentOptionFromCandidate(
        candidate,
        "",
        "문제",
      )
    );
  return ensureEvidenceBackedOptions(options, {
    fallbackLabel: "직접 입력: scan보다 더 정확한 문제",
    fallbackDescription: "문제 근거가 부족하면 최근 사건/비용 기준으로 보정합니다.",
    fallbackPreview: "직접 입력",
    preferDirectFallback: true,
  });
}

function buildAlignmentOutcomeOptions(bank, outcome, projectGoal = "") {
  const blockedGoalLabels = new Set(
    [projectGoal, ...(bank.goals || []).map((candidate) => candidate.value)]
      .map((value) => comparableOptionText(value))
      .filter(Boolean)
  );
  const outcomeContext = { signals: {
    currentIcpGuess: bank.targetUsers?.[0]?.value,
    likelyUsers: (bank.targetUsers || []).slice(1).map((candidate) => candidate.value),
  } };
  const options = bank.successSignals
    .filter((candidate) => !blockedGoalLabels.has(comparableOptionText(candidate.value)))
    .slice(0, 3)
    .map((candidate) =>
      alignmentOptionFromCandidate(
        { ...candidate, value: sanitizeOutcomeActionText(candidate.value, outcomeContext) },
        "",
        "확인할 행동",
      )
    )
    .filter((optionValue) => cleanText(optionValue?.label));
  if (options.length === 0 && !isGenericAlignmentText(outcome)) {
    const fallbackRef = bank.goals[0]?.evidenceRef || bank.problems[0]?.evidenceRef || bank.defaultRef;
    const fallbackOutcome = sanitizeOutcomeActionText(outcome, outcomeContext);
    if (fallbackOutcome) {
      options.push(alignmentOptionFromCandidate(
        evidenceCandidate(fallbackOutcome, fallbackRef, "outcome"),
        "",
        "확인할 행동",
      ));
    }
  }
  return ensureEvidenceBackedOptions(options, {
    fallbackLabel: "직접 입력: 다음 검증에서 확인할 행동",
    fallbackDescription: "행동 신호 근거가 부족하면 기능이 아니라 고객 반응과 현재 대안을 씁니다.",
    fallbackPreview: "직접 입력",
  });
}

function alignmentOptionFromCandidate(candidate, description, preview, antiSignal = false) {
  const metadata = optionMetadataFromCandidate(candidate);
  const optionDescription = cleanText(description)
    || alignmentOptionDescriptionFromCandidate(candidate, preview, metadata);
  return alignmentOption(
    "",
    candidate.value,
    optionDescription,
    preview,
    antiSignal || candidate.evidenceLimited === true,
    metadata,
  );
}

function alignmentOptionDescriptionFromCandidate(candidate = {}, preview = "", metadata = {}) {
  const label = cleanSignalText(candidate.value);
  const evidenceLabel = cleanText(metadata.evidenceLabel);
  const evidence = evidenceLabel && evidenceLabel !== EVIDENCE_LIMITED_LABEL ? ` · ${evidenceLabel}` : "";
  if (preview === "고객") {
    return `${label} 후보가 이번 주 실제 대화 가능한 고객인지 확인합니다.${evidence}`;
  }
  if (preview === "문제") {
    return `${label} 문제가 시간, 돈, 리스크 비용으로 반복되는지 확인합니다.${evidence}`;
  }
  if (preview === "확인할 행동") {
    return `${label} 신호를 최근 사건, 현재 대안, 지불 의향 같은 행동으로 확인합니다.${evidence}`;
  }
  return evidence ? `${label}${evidence}` : label;
}

function ensureEvidenceBackedOptions(options, {
  fallbackLabel,
  fallbackDescription,
  fallbackPreview,
  preferDirectFallback = false,
  min = 2,
  max = 4,
} = {}) {
  const cleaned = uniqueBy(
    options.filter(Boolean),
    (optionValue) => cleanText(optionValue.label).toLowerCase()
  ).slice(0, max);
  while (cleaned.length < min) {
    const index = cleaned.length + 1;
    const hasPrimaryFallback = cleaned.some((optionValue) => cleanText(optionValue.label) === fallbackLabel);
    const usePrimaryFallback = index === 1 || (preferDirectFallback && !hasPrimaryFallback);
    cleaned.push(option(
      usePrimaryFallback ? fallbackLabel : "추가 scan 필요: 선택지 근거 부족",
      usePrimaryFallback ? fallbackDescription : "선택지를 자신 있게 만들 scan 근거가 아직 부족합니다.",
      usePrimaryFallback ? fallbackPreview : EVIDENCE_LIMITED_LABEL,
      !usePrimaryFallback,
      { evidenceLabel: EVIDENCE_LIMITED_LABEL, evidenceLimited: true },
    ));
  }
  return cleaned.map((optionValue, index) => ({
    ...optionValue,
    id: cleanToken(optionValue.id) || `o${index + 1}`,
  }));
}

function alignmentComponentsAsQuestions(components) {
  return [
    components.icp,
    components.painPoint,
    components.outcome,
  ].map((component) => ({
    id: component.id,
    dimension: component.id,
    title: component.title,
    prompt: component.prompt,
  }));
}

function alignmentOption(id, label, description, preview, antiSignal = false, metadata = {}) {
  const evidenceLabel = cleanText(metadata.evidenceLabel);
  const evidenceLimited = metadata.evidenceLimited === true || evidenceLabel === EVIDENCE_LIMITED_LABEL;
  return {
    id,
    label,
    description: evidenceLimited
      ? optionDescriptionWithEvidence(description, evidenceLabel, evidenceLimited)
      : cleanText(description),
    preview,
    antiSignal,
    evidenceLabel,
    evidenceLimited,
  };
}

function buildAdaptiveQuestions(signals) {
  const dimensions = chooseQuestionDimensions(signals);
  return dimensions.map((dimension, index) => {
    const built = questionForDimension(dimension, signals);
    return {
      id: `q${index + 1}_${dimension}`,
      dimension,
      title: built.title,
      prompt: built.prompt,
      helperText: built.helperText,
      options: built.options.map((option, optionIndex) => ({
        id: `o${optionIndex + 1}`,
        label: option.label,
        description: option.description,
        preview: option.preview || option.label,
        antiSignal: option.antiSignal === true,
        evidenceLabel: cleanText(option.evidenceLabel),
        evidenceLimited: option.evidenceLimited === true,
      })),
      allowFreeText: true,
      freeTextPlaceholder: built.freeTextPlaceholder,
    };
  });
}

function chooseQuestionDimensions(signals) {
  const missing = new Set(signals.missingAssumptions || []);
  const confidence = signals.confidence || "low";
  if (confidence === "low" || missing.has("current_icp") || missing.has("core_need")) {
    return [
      "must_have",
      "core_need",
      "current_alternative",
      "buyer_user",
      "reference_customer",
    ];
  }
  if ((signals.evidenceRefs || []).length >= 4 && confidence === "high") {
    return [
      "must_have",
      "current_alternative",
      "bad_fit_boundary",
      "reference_customer",
    ];
  }
  return [
    "must_have",
    "core_need",
    "current_alternative",
    "bad_fit_boundary",
  ];
}

function questionForDimension(dimension, signals) {
  const product = signals.productName || "이 제품";
  const bank = scanEvidenceBankForSignals(signals);
  const user = targetFragment(bank.targetUsers[0]?.value || signals.currentIcpGuess || signals.likelyUsers?.[0] || "잠재 고객");
  const problem = problemFragment(bank.problems[0]?.value || signals.problem || "핵심 문제");

  switch (dimension) {
  case "must_have":
    return {
      title: "질문 — Must-have 조건",
      prompt: `${product}의 좋은 고객이라면 이미 갖고 있어야 하는 조건은 무엇인가요?`,
      helperText: "직함보다 '좋은 고객이면 이미 가지고 있는 조건'을 고릅니다.",
      freeTextPlaceholder: "예: 이미 같은 문제를 매주 직접 처리하고 있는 팀",
      options: evidenceBackedQuestionOptions([
        ...bank.targetUsers.slice(0, 2).map((candidate) =>
          optionFromCandidate(candidate, `${candidate.value}이라는 고객 조건을 우선 검증합니다.`, "ICP")
        ),
        ...bank.problems.slice(0, 1).map((candidate) =>
          optionFromCandidate(candidate, `${candidate.value}을 지금 해결하려는 조건입니다.`, "Need")
        ),
        ...bank.alternatives.slice(0, 1).map((candidate) =>
          optionFromCandidate(candidate, `${candidate.value} 같은 현재 대안/반복 행동이 이미 있습니다.`, "Have")
        ),
      ], {
        fallbackLabel: "직접 입력: scan보다 더 정확한 필수 조건",
        fallbackDescription: "필수 조건을 만들 근거가 부족하면 직접 보정합니다.",
        fallbackPreview: "직접 입력",
      }),
    };
  case "core_need":
    return {
      title: "질문 — Core need",
      prompt: `이 ICP가 ${product}를 써야 하는 가장 날카로운 need는 무엇인가요?`,
      helperText: "해결하면 좋다가 아니라, 해결하지 않으면 지금 비용이 나는 문제를 고릅니다.",
      freeTextPlaceholder: "예: 고객 대응 전에 매번 로그를 뒤져야 해서 배포가 늦어짐",
      options: evidenceBackedQuestionOptions([
        ...bank.problems.slice(0, 3).map((candidate) =>
          optionFromCandidate(candidate, "scan에서 확인된 핵심 need입니다.", "Need")
        ),
        ...bank.successSignals.slice(0, 1).map((candidate) =>
          optionFromCandidate(candidate, "목표/결과 문서에서 이어지는 need입니다.", "Outcome")
        ),
      ], {
        fallbackLabel: "직접 입력: scan보다 더 정확한 core need",
        fallbackDescription: "need 근거가 부족하면 최근 비용/반복 사건 기준으로 씁니다.",
        fallbackPreview: "직접 입력",
      }),
    };
  case "current_alternative":
    return {
      title: "질문 — 현재 대안",
      prompt: "좋은 고객은 오늘 이 문제를 무엇으로 버티고 있나요?",
      helperText: "대체재가 선명할수록 가격, 메시지, wedge가 같이 좁아집니다.",
      freeTextPlaceholder: "예: Notion 템플릿 + 수동 CSV export",
      options: evidenceBackedQuestionOptions(
        bank.alternatives.slice(0, 4).map((candidate) =>
          optionFromCandidate(candidate, "scan에서 잡힌 현재 대안입니다.", "Alternative")
        ),
        {
          fallbackLabel: "직접 입력: scan에 없는 현재 대안",
          fallbackDescription: "현재 대안 근거가 부족하면 고객이 오늘 버티는 방식을 직접 씁니다.",
          fallbackPreview: "직접 입력",
        }
      ),
    };
  case "buyer_user":
    return {
      title: "질문 — 사용자와 구매자",
      prompt: "처음 써볼 사람과 돈/승인을 결정할 사람은 같은가요?",
      helperText: "초기 ICP는 sales cycle이 짧아야 테스트 속도가 납니다.",
      freeTextPlaceholder: "예: 개발자가 바로 카드 결제 가능하지만 보안 승인은 CTO가 봄",
      options: evidenceBackedQuestionOptions(
        bank.buyerSignals.slice(0, 4).map((candidate) =>
          optionFromCandidate(candidate, "scan의 고객/조직 신호에서 나온 buyer 가설입니다.", "Buyer")
        ),
        {
          fallbackLabel: "직접 입력: 사용자와 구매자 관계",
          fallbackDescription: "구매/승인 흐름 근거가 부족하면 직접 보정합니다.",
          fallbackPreview: "직접 입력",
        }
      ),
    };
  case "activation_or_success_signal":
    return {
      title: "질문 — 성공 신호",
      prompt: "이 ICP가 맞다면 어떤 행동이 가장 먼저 보여야 하나요?",
      helperText: "말보다 activation/retention으로 검증할 수 있는 행동을 고릅니다.",
      freeTextPlaceholder: "예: 첫 세션에서 팀원 2명을 초대하고 같은 작업을 반복 실행",
      options: evidenceBackedQuestionOptions(
        bank.successSignals.slice(0, 4).map((candidate) =>
          optionFromCandidate(candidate, "scan 목표/통증에서 이어지는 성공 신호입니다.", "Success")
        ),
        {
          fallbackLabel: "직접 입력: scan보다 정확한 성공 행동",
          fallbackDescription: "성공 신호 근거가 부족하면 측정 가능한 행동으로 씁니다.",
          fallbackPreview: "직접 입력",
        }
      ),
    };
  case "willingness_to_pay":
    return {
      title: "질문 — 지불 의향",
      prompt: "좋은 고객은 이 문제에 이미 어떤 비용을 쓰고 있나요?",
      helperText: "사랑하지만 안 사는 persona를 피하기 위한 질문입니다.",
      freeTextPlaceholder: "예: 매주 3시간 수작업, 월 $80 도구, 외주 비용",
      options: evidenceBackedQuestionOptions(
        bank.paySignals.slice(0, 4).map((candidate) =>
          optionFromCandidate(candidate, "scan에서 확인된 비용/가격 검증 신호입니다.", "Pay")
        ),
        {
          fallbackLabel: "직접 입력: 시간·돈·리스크 비용",
          fallbackDescription: "지불 의향 근거가 부족하면 고객이 이미 쓰는 비용을 직접 씁니다.",
          fallbackPreview: "직접 입력",
        }
      ),
    };
  case "bad_fit_boundary":
    return {
      title: "질문 — Anti-ICP 경계",
      prompt: "이번 주 인터뷰에서 제외해야 할 신호는 무엇인가요?",
      helperText: "polite interest를 걸러야 Day 3 인터뷰가 실제 학습으로 이어집니다.",
      freeTextPlaceholder: "예: 데모에는 반응하지만 최근 사건, 대체재, 예산이 모두 없음",
      options: evidenceBackedQuestionOptions(
        bank.antiSignals.slice(0, 4).map((candidate) =>
          optionFromCandidate(candidate, "scan에서 보이는 제외/공백 신호입니다.", "Exclude", true)
        ),
        {
          fallbackLabel: "직접 입력: 제외할 Anti-ICP 신호",
          fallbackDescription: "제외 신호 근거가 부족하면 인터뷰에서 걸러낼 조건을 직접 씁니다.",
          fallbackPreview: "직접 입력",
          antiSignal: true,
        }
      ).map((optionValue) => ({ ...optionValue, antiSignal: true })),
    };
  case "reference_customer":
  default:
    return {
      title: "질문 — Reference customer",
      prompt: "이 ICP v0를 이번 주에 누구에게 먼저 검증할 수 있나요?",
      helperText: "완벽한 대표 고객보다 바로 물어볼 수 있는 reference customer가 필요합니다.",
      freeTextPlaceholder: "예: 최근 같은 문제를 공개적으로 말한 팀 리드 1명",
      options: referenceCustomerOptions(signals, user, bank),
    };
  }
}

function evidenceBackedQuestionOptions(options, fallback) {
  return ensureEvidenceBackedOptions(options, fallback);
}

function optionFromCandidate(candidate, description, preview, antiSignal = false) {
  return option(
    candidate.value,
    description,
    preview,
    antiSignal || candidate.evidenceLimited === true,
    optionMetadataFromCandidate(candidate),
  );
}

function optionMetadataFromCandidate(candidate = {}) {
  return {
    evidenceLabel: candidate.evidenceLabel,
    evidenceLimited: candidate.evidenceLimited === true,
  };
}

function option(label, description, preview, antiSignal = false, metadata = {}) {
  const evidenceLabel = cleanText(metadata.evidenceLabel);
  const evidenceLimited = metadata.evidenceLimited === true || evidenceLabel === EVIDENCE_LIMITED_LABEL;
  return {
    label,
    description: optionDescriptionWithEvidence(description, evidenceLabel, evidenceLimited),
    preview,
    antiSignal,
    evidenceLabel,
    evidenceLimited,
  };
}

function optionDescriptionWithEvidence(description, evidenceLabel, evidenceLimited) {
  const base = cleanText(description);
  if (evidenceLimited) {
    return base.startsWith(EVIDENCE_LIMITED_LABEL) ? base : `${EVIDENCE_LIMITED_LABEL}: ${base}`;
  }
  if (!evidenceLabel) return base;
  return base.includes("근거:") ? base : `${base} · ${evidenceLabel}`;
}

function referenceCustomerOptions(signals, user, bank = scanEvidenceBankForSignals(signals)) {
  const options = bank.referenceCustomers.slice(0, 4).map((candidate) =>
    optionFromCandidate(candidate, "scan의 고객 후보를 실제 사람으로 바꿉니다.", "Reference")
  );
  if (options.length === 0 && user && user !== "잠재 고객") {
    options.push(optionFromCandidate(
      limitedCandidate(`${user} 중 이번 주 20분 인터뷰 가능한 1명`, "reference_customer"),
      "reference customer 근거가 부족하면 실제 이름/채널로 보정합니다.",
      "직접 입력",
    ));
  }
  return ensureEvidenceBackedOptions(options, {
    fallbackLabel: "직접 입력: 이번 주 20분 인터뷰를 요청할 수 있는 한 사람",
    fallbackDescription: "reference customer 근거가 부족하면 이름이나 채널까지 직접 적습니다.",
    fallbackPreview: "직접 입력",
  });
}

function buildIcpDraft(signals, questions) {
  const target = signals.currentIcpGuess || signals.likelyUsers?.[0] || "아직 좁히는 중인 잠재 고객";
  const problem = signals.problem || USER_FACING_GENERIC_PROBLEM;
  return {
    description: `${target} 중 ${problem}을 지금 해결하려는 고객.`,
    criteria: [
      "need가 오늘의 업무/매출/리스크에 연결된다",
      "현재 대안이나 반복 행동이 있다",
      "이번 주 20분 인터뷰를 요청할 수 있다",
    ],
    whyTheyMatter: [
      "초기 ICP는 넓은 persona가 아니라 테스트 가능한 고객 조건이어야 한다",
      "현재 대안과 지불/시간 비용이 있어야 pricing과 wedge를 배울 수 있다",
      "reference customer가 빠르게 잡혀야 Day 3 인터뷰 품질이 올라간다",
    ],
    needs: [
      problem,
      "문제를 더 빠르고 신뢰성 있게 해결할 방법",
    ].filter(Boolean),
    haves: [
      signals.currentAlternatives?.[0],
      signals.evidenceRefs?.[0]?.path ? `evidence: ${signals.evidenceRefs[0].path}` : null,
    ].filter(Boolean),
    dontNeeds: [
      "막연한 관심만 있고 최근 사건이 없는 사용자",
      "사용자는 아니지만 의견만 주는 proxy persona",
    ],
    evidence: (signals.evidenceRefs || []).map((ref) => `${ref.path}: ${ref.reason}`),
    referenceCustomersToFind: questions
      .find((question) => question.dimension === "reference_customer")
      ?.options.map((option) => option.label)
      .slice(0, 3) || ["이번 주 20분 인터뷰가 가능한 사람 1명"],
  };
}

function buildAntiIcp(signals) {
  return {
    summary: "좋은 반응보다 실제 need/have/behavior가 없으면 Day 3 인터뷰 대상에서 제외합니다.",
    rules: [
      {
        id: "polite_interest",
        label: "\"흥미롭네요\"만 말하고 최근 사건이 없음",
        reason: "polite interest는 PMF/ICP 신호가 아니라 대화 예절일 수 있습니다.",
        evidenceRef: null,
      },
      {
        id: "no_current_alternative",
        label: "현재 대안, 반복 행동, 시간/돈 비용이 없음",
        reason: "대체재가 없으면 pricing과 wedge를 검증하기 어렵습니다.",
        evidenceRef: null,
      },
      {
        id: "proxy_persona",
        label: "문제를 직접 겪지 않는 조언자/구경꾼",
        reason: `${signals.productName || "제품"}의 초기 persona를 흐립니다.`,
        evidenceRef: null,
      },
    ],
    politeInterestGuardrails: [
      "최근 7일 안의 실제 사건을 묻는다",
      "지금 쓰는 대안과 비용을 묻는다",
      "추천할 사람보다 본인이 겪는 문제를 먼저 묻는다",
    ],
  };
}

function buildFirstInterviewMessage(signals, questions) {
  const product = signals.productName || "이 프로젝트";
  const target = signals.currentIcpGuess || "이 문제를 직접 겪는 분";
  const problem = signals.problem || "지금 해결하려는 문제";
  const messageQuestions = questions.slice(0, 3).map((question) => question.prompt);
  return {
    channel: "DM/email/Slack",
    recipientPlaceholder: "{name}",
    subject: `${product} ICP v0 인터뷰 요청`,
    bodyTemplate: [
      "안녕하세요 {name}님,",
      `${product}의 첫 ICP를 좁히는 중인데, ${target} 중에서 "${problem}"을 실제로 겪는 분을 찾고 있습니다.`,
      "이번 주 20분만 짧게 여쭤볼 수 있을까요? 제품 소개보다 지금 쓰는 대안과 최근 사건을 듣고 싶습니다.",
      "",
      "질문은 세 가지만 드릴게요:",
      ...messageQuestions.map((question, index) => `${index + 1}) ${question}`),
      "",
      "부담되면 텍스트로 답해주셔도 괜찮습니다.",
    ].join("\n"),
    questions: messageQuestions,
  };
}

function inferCurrentAlternatives({ projectKind, context, localDiscovery }) {
  const lower = String(context || "").toLowerCase();
  const stacks = new Set(localDiscovery?.project?.stacks || []);
  const alternatives = [];
  const add = (value) => {
    if (value && !alternatives.includes(value)) alternatives.push(value);
  };

  if (/notion|spreadsheet|sheet|csv|airtable/.test(lower)) {
    add("스프레드시트/Notion/Airtable로 수동 관리");
  }
  if (/slack|email|gmail|inbox|support/.test(lower)) {
    add("Slack/메일 thread를 사람이 직접 확인");
  }
  if (/github|issue|pull request|pr|code|developer|cli|sdk/.test(lower) || stacks.has("node") || stacks.has("swift")) {
    add("GitHub/IDE/CLI와 수동 스크립트 조합");
  }
  if (/analytics|posthog|dashboard|metric/.test(lower)) {
    add("analytics dashboard를 직접 뒤져서 판단");
  }
  if (projectKind === "web_app") add("기존 SaaS와 내부 운영 문서 조합");
  if (projectKind === "developer_tool") add("터미널/에디터 플러그인과 자체 스크립트");

  add("범용 AI/검색/문서 도구로 임시 해결");
  add("아직 명확한 대안 없이 미루는 상태");
  return alternatives.slice(0, 4);
}

function inferMissingAssumptions({ scanResult, currentIcpGuess, problem, evidence, confidence }) {
  const missing = [];
  if (!currentIcpGuess) missing.push("current_icp");
  if (!problem) missing.push("core_need");
  if ((evidence || []).length < 2) missing.push("evidence");
  if (confidence === "low") missing.push("reference_customer");
  return missing.slice(0, 8);
}

function inferSignalConfidence({ evidence, currentIcpGuess, problem }) {
  const score = (evidence?.length || 0) + (currentIcpGuess ? 2 : 0) + (problem ? 2 : 0);
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function confidenceScore(confidence, evidenceCount, questionCount) {
  const base = confidence === "high" ? 0.78 : confidence === "medium" ? 0.58 : 0.36;
  const evidenceBonus = Math.min(0.12, Math.max(0, evidenceCount) * 0.02);
  const questionPenalty = questionCount > 4 ? 0.03 : 0;
  return Math.max(0.2, Math.min(0.92, Number((base + evidenceBonus - questionPenalty).toFixed(2))));
}

function buildDay1IcpComposerPrompt(plan) {
  return [
    "You are improving a Day 1 ICP v0 plan for a startup onboarding flow.",
    "Use PostHog's ICP pattern: start with the best guess; define Description, Criteria, Why they matter, Needs, Haves, Don't needs; prefer actual need/have/behavior over industry/title proxies; separate ICP from persona; include Anti-ICP guardrails for polite interest.",
    "You may inspect the workspace with read-only tools only. Do not edit files. Do not run commands.",
    "Return one JSON object matching the provided schema. Keep 3-5 adaptive questions. Do not force fixed axes like distance/tools/stuck/last7d unless the workspace evidence makes them truly relevant.",
    "",
    "DETERMINISTIC_PLAN_JSON:",
    JSON.stringify(plan, null, 2).slice(0, MAX_CONTEXT_CHARS),
  ].join("\n");
}

export function buildDay1AlignmentComposerPrompt(plan) {
  return [
    "You are improving a Day 1 startup onboarding alignment plan.",
    "The new Day 1 contract is not an ICP questionnaire. It must produce one project goal and a structured alignment statement with exactly three user-facing components: 고객, 문제, 확인할 행동. Keep the JSON keys as icp, painPoint, and outcome for compatibility.",
    "Use workspace evidence. Keep the Day 1 questions actionable without assuming the user already understands Day 2. Do not edit files. Do not run commands.",
    "Return one JSON object only. Do not wrap it in markdown, do not include prose outside JSON, and do not repeat long source paragraphs.",
    "Preserve projectGoal, components.icp, components.painPoint, components.outcome, alignmentStatement, qualityGate, firstInterviewMessage, and day2Handoff. The quality gate is a 0-10 score and should pass at 7.0+ only when the statement is specific enough for the next market-signal validation.",
    "For each of components.icp.options, components.painPoint.options, and components.outcome.options, return exactly 5 choices. Aim for 4 evidence-backed candidates and at most 1 weak/exclusion signal.",
    "Every option must include a non-empty description, evidenceLabel, and evidenceLimited boolean. Evidence-backed descriptions should say why this option is a strong Day 1 choice; weak options should explain the missing signal.",
    "Do not use direct-input, scan-needed, schema, upload, transcript-entry, file-entry, or product-input placeholders as selectable options.",
    "Every component prompt must be understandable in the Day 1 card and should ask for a concrete customer, pain, or behavior signal.",
    "Do not put \"Day 2\" or \"Day2\" in component prompts, helper text, or option labels/descriptions. Reserve Day 2 wording for day2Handoff only.",
    "For components.outcome, write an observable validation action. Do not copy the ICP/customer segment, product goal, business metric, pain sentence, document pointer, persona Job summary, Motivation, Frustration, or product feature as a 확인할 행동 option.",
    "확인할 행동 labels and statements must not repeat the concrete 고객/ICP segment; keep customer segments only in components.icp and write outcome as the behavior to observe or validate.",
    "Every choice label must answer its component's question directly: 고객 choices are customer segments, 문제 choices are customer pains/costs, 확인할 행동 choices are customer behavior or market-signal actions.",
    "Add signalDigest for direct UI rendering. signalDigest.rows must be exactly this order: project, goal, icp, pain, outcome, evidence.",
    "The project signalDigest row value must be the display product name only. Do not include quality score, confidence, or other metadata in the project row.",
    "Each other signalDigest row value must be concise Korean display copy: goal <= 120 chars, icp <= 90 chars, pain <= 80 chars, outcome <= 110 chars. signalDigest.summary <= 160 chars.",
    "",
    "DETERMINISTIC_ALIGNMENT_PLAN_JSON:",
    JSON.stringify(plan, null, 2).slice(0, MAX_CONTEXT_CHARS),
  ].join("\n");
}

async function runPlanComposerWithTimeout({ queryImpl, prompt, workspaceRoot, canUseTool, timeoutMs }) {
  const abortController = new AbortController();
  const llmCall = Promise.resolve(queryImpl({
    prompt,
    options: {
      cwd: workspaceRoot,
      allowedTools: [...READ_ONLY_WORKSPACE_ALLOWED_TOOLS],
      tools: [...READ_ONLY_WORKSPACE_ALLOWED_TOOLS],
      canUseTool,
      abortController,
    },
  }));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      abortController.abort();
      reject(new Error("day1_icp_plan_timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([llmCall, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function fallbackDay1IcpPlan({ workspaceRoot, now = new Date() } = {}) {
  const productName = inferProductName(workspaceRoot, []);
  const signals = {
    productName,
    currentIcpGuess: "",
    likelyUsers: [],
    problem: "",
    currentAlternatives: ["스프레드시트/문서로 수동 처리", "기존 범용 도구 조합", "내부 스크립트나 임시 프로세스", "아직 뚜렷한 대안 없음"],
    evidenceRefs: [],
    missingAssumptions: ["current_icp", "core_need", "evidence", "reference_customer"],
    confidence: "low",
  };
  const questions = buildAdaptiveQuestions(signals);
  return {
    schemaVersion: DAY1_ICP_PLAN_SCHEMA_VERSION,
    source: "deterministic",
    generatedAt: toIso(now),
    confidence: 0.32,
    fellBackToDeterministic: true,
    mission: buildMission(signals),
    signals,
    questions,
    icpDraft: buildIcpDraft(signals, questions),
    antiIcp: buildAntiIcp(signals),
    firstInterviewMessage: buildFirstInterviewMessage(signals, questions),
  };
}

function fallbackDay1AlignmentPlan({ workspaceRoot, now = new Date() } = {}) {
  const legacyPlan = fallbackDay1IcpPlan({ workspaceRoot, now });
  const projectGoal = buildProjectGoal({
    signals: legacyPlan.signals,
    onboardingHypothesis: null,
    evidence: [],
  });
  const components = buildAlignmentComponents({
    signals: legacyPlan.signals,
    projectGoal,
  });
  const alignmentStatement = buildAlignmentStatement({ projectGoal, components });
  const qualityGate = buildAlignmentQualityGate({
    projectGoal,
    signals: legacyPlan.signals,
    components,
    evidence: [],
  });
  const plan = {
    schemaVersion: DAY1_ALIGNMENT_PLAN_SCHEMA_VERSION,
    source: "deterministic",
    generatedAt: toIso(now),
    confidence: 0.32,
    fellBackToDeterministic: true,
    projectGoal,
    mission: buildAlignmentMission({
      signals: legacyPlan.signals,
      projectGoal,
    }),
    signals: legacyPlan.signals,
    components,
    alignmentStatement,
    qualityGate,
    firstInterviewMessage: buildFirstInterviewMessage(
      legacyPlan.signals,
      alignmentComponentsAsQuestions(components),
    ),
    day2Handoff: buildDay2Handoff({
      signals: legacyPlan.signals,
      projectGoal,
      alignmentStatement,
      qualityGate,
    }),
  };
  plan.signalDigest = buildConciseSignalDigest(plan);
  return plan;
}

function normalizeAlignmentComponents(value) {
  if (!value || typeof value !== "object") return null;
  const icp = normalizeAlignmentComponent(value.icp, "icp");
  const painPoint = normalizeAlignmentComponent(value.painPoint || value.pain_point, "pain_point");
  const outcome = normalizeAlignmentComponent(value.outcome, "outcome");
  if (!icp || !painPoint || !outcome) return null;
  return { icp, painPoint, outcome };
}

function normalizeAlignmentComponent(value, fallbackId) {
  if (!value || typeof value !== "object") return null;
  const id = cleanToken(value.id) || fallbackId;
  const title = alignmentComponentTitle(id);
  const prompt = cleanText(value.prompt || value.question);
  const statement = cleanText(value.statement || value.value);
  const options = Array.isArray(value.options)
    ? value.options.map((optionValue, optionIndex) =>
      normalizeAlignmentOption(optionValue, optionIndex)
    ).filter(Boolean).slice(0, 5)
    : [];
  if (!prompt || !statement || options.length < 2) return null;
  return {
    id,
    title,
    prompt,
    helperText: cleanText(value.helperText || value.helper_text),
    statement,
    evidence: normalizeStringArray(value.evidence).slice(0, 8),
    missingAssumptions: normalizeStringArray(value.missingAssumptions || value.missing_assumptions).slice(0, 6),
    options,
  };
}

function normalizeAlignmentOption(value, index) {
  if (!value || typeof value !== "object") return null;
  const label = cleanText(value.label || value.title);
  if (!label) return null;
  const evidenceLabel = cleanText(value.evidenceLabel || value.evidence_label);
  return {
    id: cleanToken(value.id) || `o${index + 1}`,
    label,
    description: cleanText(value.description || value.detail),
    preview: cleanText(value.preview),
    antiSignal: Boolean(value.antiSignal || value.anti_signal),
    evidenceLabel,
    evidenceLimited: Boolean(value.evidenceLimited || value.evidence_limited || evidenceLabel === EVIDENCE_LIMITED_LABEL),
  };
}

function sanitizeNormalizedAlignmentComponents(components, { signals, projectGoal } = {}) {
  if (!components) return null;
  const icp = sanitizeAlignmentFragment("icp", components.icp.statement, [
    signals?.currentIcpGuess,
    signals?.likelyUsers?.[0],
    "첫 고객 후보 확인 필요",
  ]);
  const painPoint = sanitizeAlignmentFragment("pain", components.painPoint.statement, [
    signals?.problem,
    "핵심 문제 확인 필요",
  ]);
  const painOptions = components.painPoint.options
    .filter((optionValue) => !looksLikeProductInputArtifactPain(optionValue.label));
  const outcomeContext = { signals, components, alignmentStatement: { icp } };
  const outcome = sanitizeAlignmentFragment("outcome", components.outcome.statement, [
    buildOutcomeStatement({ signals: signals || {}, projectGoal }),
    "첫 검증 행동",
  ], outcomeContext);
  const outcomeOptions = components.outcome.options
    .map((optionValue) => sanitizeAlignmentOutcomeOption(optionValue, outcomeContext))
    .filter(Boolean);
  if (!icp || !painPoint || !outcome) return null;
  return {
    icp: { ...components.icp, statement: icp },
    painPoint: { ...components.painPoint, statement: painPoint, options: painOptions },
    outcome: { ...components.outcome, statement: outcome, options: outcomeOptions },
  };
}

function normalizeAlignmentStatement(value, { projectGoal, components, signals } = {}) {
  const raw = value && typeof value === "object" ? value : {};
  const resolvedProjectGoal = sanitizeAlignmentFragment("goal", raw.projectGoal || raw.project_goal, [
    projectGoal,
  ]);
  const icp = sanitizeAlignmentFragment("icp", raw.icp, [
    components?.icp?.statement,
    signals?.currentIcpGuess,
    signals?.likelyUsers?.[0],
  ]);
  const painPoint = sanitizeAlignmentFragment("pain", raw.painPoint || raw.pain_point, [
    components?.painPoint?.statement,
    signals?.problem,
  ]);
  const outcomeContext = { signals, components, alignmentStatement: { icp } };
  const outcome = sanitizeAlignmentFragment("outcome", raw.outcome, [
    components?.outcome?.statement,
    buildOutcomeStatement({ signals: signals || {}, projectGoal }),
  ], outcomeContext);
  const statement = resolvedProjectGoal && icp && painPoint && outcome
    ? `목표: ${resolvedProjectGoal} / 고객: ${icp} / 문제: ${painPoint} / 확인할 행동: ${outcome}`
    : "";
  if (!statement || !resolvedProjectGoal || !icp || !painPoint || !outcome) return null;
  return {
    statement,
    projectGoal: resolvedProjectGoal,
    icp,
    painPoint,
    outcome,
  };
}

function sanitizeAlignmentFragment(key, value, fallbacks = [], context = {}) {
  const primary = prepareAlignmentFragment(key, cleanAlignmentFragment(value), context);
  if (primary && !looksLikeAlignmentDocumentReference(value, primary)) {
    return conciseSignalDigestValue(key, primary);
  }
  for (const fallback of fallbacks) {
    const cleaned = prepareAlignmentFragment(key, cleanAlignmentFragment(fallback), context);
    if (cleaned && !looksLikeAlignmentDocumentReference(fallback, cleaned)) {
      return conciseSignalDigestValue(key, cleaned);
    }
  }
  return "";
}

function prepareAlignmentFragment(key, value, context = {}) {
  if (key === "outcome") return sanitizeOutcomeActionText(value, context);
  return removeDanglingOpeningDelimiter(value) || value;
}

function cleanAlignmentFragment(value) {
  return cleanSignalText(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .trim();
}

function sanitizeAlignmentOutcomeOption(optionValue, context = {}) {
  const label = sanitizeOutcomeActionText(optionValue?.label, context);
  if (!label) return null;
  return { ...optionValue, label };
}

function sanitizeOutcomeActionText(value, context = {}) {
  let text = cleanSignalText(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .trim();
  text = removeDanglingOpeningDelimiter(text) || text;
  if (!text) return "";
  for (let index = 0; index < 3; index += 1) {
    const stripped = stripKnownOutcomeCustomerPrefix(text, context)
      .replace(/^(?:그\s*)?고객(?:에게서|에게|이|가|은|는|의)\s+/u, "")
      .replace(/^(?:첫\s*고객\s*후보|잠재\s*고객)(?:에게서|에게|이|가|은|는|의)?\s+/u, "")
      .replace(/^(?:의|가|은|는|에게서|에게|한\s*명에게|1\s*명에게|\d+\s*명에게|와|과)\s+/u, "")
      .trim();
    if (stripped === text) break;
    text = stripped;
  }
  return removeDanglingOpeningDelimiter(text) || text;
}

function stripKnownOutcomeCustomerPrefix(value, context = {}) {
  let text = cleanText(value);
  for (const segment of knownOutcomeCustomerSegments(context)) {
    const escaped = escapeRegExp(segment);
    const prefixPattern = new RegExp(
      `^${escaped}\\s*(?:\\([^)]*)?\\s*(?:의|가|은|는|을|를|에게서|에게|한\\s*명에게|1\\s*명에게|\\d+\\s*명에게|와|과)?\\s*`,
      "iu",
    );
    const stripped = text.replace(prefixPattern, "").trim();
    if (stripped && stripped !== text) {
      text = stripped;
    }
  }
  return text;
}

function outcomeContainsKnownCustomerSegment(value, context = {}) {
  const text = comparableOptionText(value);
  if (!text) return false;
  return knownOutcomeCustomerSegments(context).some((segment) => {
    const comparable = comparableOptionText(segment);
    return comparable.length >= 6 && text.includes(comparable);
  });
}

function knownOutcomeCustomerSegments(context = {}) {
  const signals = context?.signals || {};
  const rawValues = [
    signals.currentIcpGuess,
    ...(Array.isArray(signals.likelyUsers) ? signals.likelyUsers : []),
    context?.alignmentStatement?.icp,
    context?.components?.icp?.statement,
  ];
  const variants = rawValues.flatMap(outcomeCustomerSegmentVariants);
  return uniqueBy(
    variants.filter((value) => value.length >= 4 && !isGenericOutcomeCustomerSegment(value)),
    (value) => comparableOptionText(value),
  ).sort((a, b) => b.length - a.length);
}

function outcomeCustomerSegmentVariants(value) {
  const text = cleanSignalText(value);
  if (!text) return [];
  const unlinked = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1").trim();
  const withoutParenthetical = removeParentheticalFragments(unlinked);
  const firstFragment = firstTopLevelFragment(unlinked);
  return [unlinked, withoutParenthetical, firstFragment, removeParentheticalFragments(firstFragment)]
    .map((variant) => cleanText(variant))
    .filter(Boolean);
}

function removeParentheticalFragments(value) {
  return cleanText(value)
    .replace(/\s*[\(（][^\)）]*(?:[\)）]|$)/gu, "")
    .replace(/\s*[\[［][^\]］]*(?:[\]］]|$)/gu, "")
    .trim();
}

function isGenericOutcomeCustomerSegment(value) {
  const text = cleanText(value).toLowerCase();
  return [
    "고객",
    "사용자",
    "잠재 고객",
    "첫 고객 후보",
    "customer",
    "user",
    "target user",
  ].includes(text);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksLikeAlignmentDocumentReference(rawValue, cleanedValue = rawValue) {
  const cleaned = cleanText(cleanedValue);
  return !cleaned
    || isGenericAlignmentText(cleaned)
    || looksLikeDocumentPointer(cleaned)
    || looksLikeSignalDigestDocumentReference(rawValue, cleaned);
}

function normalizeAlignmentQualityGate(value) {
  if (!value || typeof value !== "object") return null;
  const score = clampNumber(value.score, 0, 10, NaN);
  const threshold = clampNumber(value.threshold, 0, 10, DAY1_ALIGNMENT_QUALITY_GATE_THRESHOLD);
  if (!Number.isFinite(score)) return null;
  const criteria = Array.isArray(value.criteria)
    ? value.criteria.map(normalizeQualityCriterion).filter(Boolean).slice(0, 8)
    : [];
  if (criteria.length === 0) return null;
  return {
    score: roundNumber(score, 1),
    threshold: roundNumber(threshold, 1),
    passed: value.passed === undefined ? score >= threshold : Boolean(value.passed),
    label: cleanText(value.label) || (score >= threshold ? "PASS" : "REWORK"),
    passGate: cleanText(value.passGate || value.pass_gate),
    failGate: cleanText(value.failGate || value.fail_gate),
    criteria,
  };
}

function normalizeQualityCriterion(value) {
  if (!value || typeof value !== "object") return null;
  const id = cleanToken(value.id);
  const label = cleanText(value.label || value.title);
  const maxScore = clampNumber(value.maxScore || value.max_score, 0.1, 10, 1);
  const score = clampNumber(value.score, 0, maxScore, 0);
  if (!id || !label) return null;
  return {
    id,
    label,
    score: roundNumber(score, 1),
    maxScore: roundNumber(maxScore, 1),
    passed: value.passed === undefined ? score >= maxScore * 0.7 : Boolean(value.passed),
    detail: cleanText(value.detail || value.description),
  };
}

function normalizeDay2Handoff(value) {
  if (!value || typeof value !== "object") return null;
  const title = cleanText(value.title);
  const body = cleanText(value.body);
  const focus = cleanText(value.focus);
  const nextDayPrompt = cleanText(value.nextDayPrompt || value.next_day_prompt);
  if (!title || !body || !focus || !nextDayPrompt) return null;
  return {
    title,
    body,
    focus,
    nextDayPrompt,
    qualityGateLabel: cleanText(value.qualityGateLabel || value.quality_gate_label),
  };
}

function alignmentComponentTitle(id) {
  switch (id) {
  case "icp":
    return "고객";
  case "pain_point":
    return "문제";
  case "outcome":
    return "확인할 행동";
  default:
    return "가설";
  }
}

function normalizeSignals(value) {
  if (!value || typeof value !== "object") return null;
  const confidence = cleanToken(value.confidence) || "low";
  return {
    productName: normalizeUserFacingProjectName(value.productName || value.product_name),
    currentIcpGuess: cleanText(value.currentIcpGuess || value.current_icp_guess),
    likelyUsers: normalizeStringArray(value.likelyUsers || value.likely_users).slice(0, 6),
    problem: cleanText(value.problem),
    currentAlternatives: normalizeStringArray(value.currentAlternatives || value.current_alternatives).slice(0, 6),
    evidenceRefs: normalizeEvidenceRefs(value.evidenceRefs || value.evidence_refs).slice(0, MAX_EVIDENCE_REFS),
    missingAssumptions: normalizeStringArray(value.missingAssumptions || value.missing_assumptions).slice(0, 10),
    confidence: ["low", "medium", "high"].includes(confidence) ? confidence : "low",
  };
}

function normalizeQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((question, index) => normalizeQuestion(question, index))
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeQuestion(value, index) {
  if (!value || typeof value !== "object") return null;
  const dimension = cleanToken(value.dimension);
  if (!QUESTION_DIMENSIONS.includes(dimension)) return null;
  const title = cleanText(value.title) || `질문 ${index + 1}`;
  const prompt = cleanText(value.prompt || value.question);
  const options = Array.isArray(value.options)
    ? value.options.map((optionValue, optionIndex) => normalizeQuestionOption(optionValue, optionIndex)).filter(Boolean)
    : [];
  if (!prompt || options.length < 2) return null;
  return {
    id: cleanToken(value.id) || `q${index + 1}_${dimension}`,
    dimension,
    title,
    prompt,
    helperText: cleanText(value.helperText || value.helper_text),
    options: options.slice(0, 5),
    allowFreeText: value.allowFreeText !== false && value.allow_free_text !== false,
    freeTextPlaceholder: cleanText(value.freeTextPlaceholder || value.free_text_placeholder),
  };
}

function normalizeQuestionOption(value, index) {
  if (!value || typeof value !== "object") return null;
  const label = cleanText(value.label || value.title);
  const description = cleanText(value.description || value.detail);
  if (!label || !description) return null;
  const evidenceLabel = cleanText(value.evidenceLabel || value.evidence_label);
  return {
    id: cleanToken(value.id) || `o${index + 1}`,
    label,
    description,
    preview: cleanText(value.preview),
    antiSignal: Boolean(value.antiSignal || value.anti_signal),
    evidenceLabel,
    evidenceLimited: Boolean(value.evidenceLimited || value.evidence_limited || evidenceLabel === EVIDENCE_LIMITED_LABEL),
  };
}

function normalizeIcpDraft(value) {
  if (!value || typeof value !== "object") return null;
  const description = cleanText(value.description);
  if (!description) return null;
  return {
    description,
    criteria: normalizeStringArray(value.criteria).slice(0, 8),
    whyTheyMatter: normalizeStringArray(value.whyTheyMatter || value.why_they_matter).slice(0, 8),
    needs: normalizeStringArray(value.needs).slice(0, 8),
    haves: normalizeStringArray(value.haves).slice(0, 8),
    dontNeeds: normalizeStringArray(value.dontNeeds || value.dont_needs || value["don'tNeeds"]).slice(0, 8),
    evidence: normalizeStringArray(value.evidence).slice(0, 10),
    referenceCustomersToFind: normalizeStringArray(value.referenceCustomersToFind || value.reference_customers_to_find).slice(0, 6),
  };
}

function normalizeAntiIcp(value) {
  if (!value || typeof value !== "object") return null;
  const summary = cleanText(value.summary);
  const rules = Array.isArray(value.rules)
    ? value.rules.map(normalizeAntiIcpRule).filter(Boolean).slice(0, 6)
    : [];
  if (!summary || rules.length === 0) return null;
  return {
    summary,
    rules,
    politeInterestGuardrails: normalizeStringArray(value.politeInterestGuardrails || value.polite_interest_guardrails).slice(0, 6),
  };
}

function normalizeAntiIcpRule(value, index) {
  if (!value || typeof value !== "object") return null;
  const label = cleanText(value.label);
  const reason = cleanText(value.reason);
  if (!label || !reason) return null;
  return {
    id: cleanToken(value.id) || `anti_${index + 1}`,
    label,
    reason,
    evidenceRef: cleanText(value.evidenceRef || value.evidence_ref),
  };
}

function normalizeFirstInterviewMessage(value) {
  if (!value || typeof value !== "object") return null;
  const bodyTemplate = cleanText(value.bodyTemplate || value.body_template);
  if (!bodyTemplate) return null;
  return {
    channel: cleanText(value.channel) || "DM/email/Slack",
    recipientPlaceholder: cleanText(value.recipientPlaceholder || value.recipient_placeholder) || "{name}",
    subject: cleanText(value.subject),
    bodyTemplate,
    questions: normalizeStringArray(value.questions).slice(0, 5),
  };
}

function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeEvidenceRef).filter(Boolean);
}

function normalizeEvidenceRef(value) {
  if (!value || typeof value !== "object") return null;
  const refPath = cleanText(value.path);
  if (!refPath) return null;
  return {
    path: refPath,
    reason: cleanText(value.reason),
    quote: cleanText(value.quote),
  };
}

function inferProductName(workspaceRoot, evidence) {
  const readmeHeading = evidence
    .filter((item) => /^readme(?:\.|$)/i.test(cleanText(item.path)))
    .map((item) => item.quote)
    .find((quote) => /^#\s+/.test(quote || ""));
  const packageName = evidence
    .map((item) => packageNameFromEvidence(item))
    .map(normalizeUserFacingProjectName)
    .find(Boolean);
  const anyHeading = evidence
    .map((item) => item.quote)
    .find((quote) => /^#\s+/.test(quote || ""));
  const evidenceName = normalizeUserFacingProjectName(markdownHeadingTitle(readmeHeading))
    || packageName
    || normalizeUserFacingProjectName(markdownHeadingTitle(anyHeading));
  if (evidenceName) return evidenceName;
  const base = workspaceRoot ? path.basename(path.resolve(workspaceRoot)) : "";
  return normalizeUserFacingProjectName(base) || USER_FACING_GENERIC_PROJECT_NAME;
}

function markdownHeadingTitle(value) {
  const match = cleanText(value).match(/^#{1,6}\s+([^|#]+)/);
  return cleanText(match?.[1] || "");
}

function packageNameFromEvidence(item = {}) {
  if (!/package\.json$/i.test(cleanText(item.path))) return "";
  const quote = cleanText(item.quote);
  const match = quote.match(/"name"\s*:\s*"([^"]+)"/);
  return match?.[1] || "";
}

function normalizeUserFacingProjectName(value) {
  const text = cleanDigestDisplayText(value);
  if (!text) return "";
  const normalized = normalizeProductName(text) || cleanText(text);
  if (!normalized) return "";
  return isUserFacingProjectName(normalized) ? normalized : "";
}

function isUserFacingProjectName(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (text === USER_FACING_GENERIC_PROJECT_NAME) return true;
  return !looksLikeEphemeralWorkspaceName(text);
}

function looksLikeEphemeralWorkspaceName(value) {
  const text = cleanText(value);
  if (!text) return true;
  const comparable = text
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(comparable)) {
    return true;
  }
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(comparable)) {
    return true;
  }
  if (/^workspace-[a-z0-9]+$/i.test(comparable)) return true;
  if (/^(?:tmp|temp|test)(?:[-_.]|$)/i.test(comparable)) return true;
  if (/(?:^|[-_.])(?:tmp|temp|test|ui-test|ui-testing)(?:[-_.]|$)/i.test(comparable)) return true;
  if (/^agentic30-ui(?:[-_.]|$)/i.test(comparable)) return true;
  return false;
}

function evidenceContext(evidence) {
  return (evidence || [])
    .map((item) => `${item.path}\n${item.reason || ""}\n${item.quote || ""}`)
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);
}

function evidenceQuote(content) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("<!--"));
  const heading = lines.find((line) => /^#{1,3}\s+/.test(line));
  const signals = lines
    .filter((line) => SOURCE_SIGNAL_PATTERN.test(line) && line.length >= 12 && line !== heading)
    .slice(0, 4);
  const useful = heading && signals.length
    ? `${heading} | ${signals.join(" | ")}`
    : heading || signals[0] || lines.find((line) => line.length >= 20) || lines[0] || "";
  return cleanText(useful).slice(0, 220);
}

function firstTopLevelFragment(value) {
  const text = cleanText(value);
  if (!text) return "";
  const stack = [];
  const openers = new Map([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["（", "）"],
    ["［", "］"],
    ["｛", "｝"],
  ]);
  const closers = new Set(openers.values());
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (openers.has(char)) {
      stack.push(openers.get(char));
      continue;
    }
    if (closers.has(char)) {
      if (stack[stack.length - 1] === char) stack.pop();
      continue;
    }
    if (stack.length === 0 && /[.,，、]/.test(char)) {
      return text.slice(0, index).trim();
    }
  }
  return text;
}

function removeDanglingOpeningDelimiter(value) {
  let text = cleanText(value);
  if (!text) return "";
  const stack = [];
  const pairs = {
    "(": ")",
    "[": "]",
    "{": "}",
    "（": "）",
    "［": "］",
    "｛": "｝",
  };
  const openerForCloser = Object.fromEntries(Object.entries(pairs).map(([open, close]) => [close, open]));
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (pairs[char]) {
      stack.push({ char, index });
      continue;
    }
    const expectedOpen = openerForCloser[char];
    if (expectedOpen && stack[stack.length - 1]?.char === expectedOpen) {
      stack.pop();
    }
  }
  if (stack.length > 0) {
    text = text.slice(0, stack[0].index).trim();
  }
  return text.replace(/\s+[·,/:-]\s*$/u, "").trim();
}

function targetFragment(value) {
  const text = removeDanglingOpeningDelimiter(firstTopLevelFragment(value));
  if (!text) return "잠재 고객";
  return conciseText(text, 60);
}

function outcomeTargetFragment(value) {
  const text = targetFragment(value)
    .replace(/\s+중$/g, "")
    .replace(/[.。．]+$/u, "")
    .trim();
  return text || "첫 고객 후보";
}

function problemFragment(value) {
  const text = removeDanglingOpeningDelimiter(firstTopLevelFragment(value));
  if (!text) return "핵심 문제";
  return conciseText(text, 72);
}

function outcomeProblemFragment(value) {
  const text = cleanSignalText(value)
    .replace(/^problem[:：-]\s*/i, "")
    .replace(/^pain[:：-]\s*/i, "")
    .replace(/^핵심 문제는\s*/i, "")
    .replace(/[“”"]/g, "")
    .replace(/\s+문제$/g, "")
    .replace(/[.。．]+$/u, "")
    .trim();
  if (!text || isGenericAlignmentText(text) || looksLikeDocumentPointer(text)) return "";
  if (/무엇을\s*(?:만들어야|팔아야|팔지)|누구에게\s*팔|첫\s*사용자|데려올|오늘\s*무엇을\s*검증/.test(text)) {
    return "무엇을 팔지/누구에게 팔지/오늘 검증할 행동";
  }
  return conciseText(text, 70);
}

function outcomeGoalFragment(value) {
  const text = cleanSignalText(value)
    .replace(/[“”"]/g, "")
    .replace(/[.。．]+$/u, "")
    .trim();
  if (!text || isGenericAlignmentText(text) || looksLikeDocumentPointer(text)) return "";
  if (/부트캠프|사용자\s*\d+명.*첫\s*매출|첫\s*매출\s*달성.*목표/i.test(text)) {
    return "첫 고객 증거";
  }
  return conciseText(text, 56);
}

function sentenceFragment(value, max) {
  return conciseText(firstSentence(value) || value, max);
}

function twoClauseFragment(value, max) {
  const text = firstSentence(value) || cleanSignalText(value);
  const clauses = text
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const selected = clauses.length >= 2 ? clauses.slice(0, 2).join(", ") : text;
  return conciseText(selected, max);
}

function firstSentence(value) {
  const text = cleanSignalText(value);
  if (!text) return "";
  const match = text.match(/^(.+?[.!?。])(?:\s|$)/);
  return (match?.[1] || text.split(/[。]/)[0] || text).trim();
}

function conciseText(value, max) {
  const text = removeDanglingOpeningDelimiter(cleanSignalText(value)) || cleanSignalText(value);
  if (!text) return "";
  if (text.length <= max) return text;
  const truncated = text.slice(0, Math.max(0, max - 1)).trim();
  const balanced = removeDanglingOpeningDelimiter(truncated) || truncated;
  return `${balanced}…`;
}

function cleanSignalText(value) {
  return cleanText(value)
    .replace(/\*\*/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function cleanMultilineText(value) {
  if (typeof value !== "string") return "";
  return value
    .split(/\r?\n/u)
    .map((line) => cleanText(line))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function cleanToken(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isGenericAlignmentText(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return true;
  return [
    "이 프로젝트",
    "핵심 문제",
    "잠재 고객",
    "첫 고객 후보",
    "current user",
    "target user",
    "core problem",
  ].some((marker) => text === marker || text.includes(`"${marker}"`));
}

function isHighQualityAlignmentText(key, value) {
  const text = cleanSignalText(value);
  if (!text || isGenericAlignmentText(text)) return false;
  if (/확인\s*필요|근거\s*부족|첫\s*검증\s*행동/.test(text)) return false;
  if (looksLikeDocumentPointer(text) || looksLikeSignalDigestDocumentReference(text, text)) return false;
  if (looksLikeSourcePathOnly(text)) return false;
  if (/^[\d\s,./:;+-]+$/.test(text)) return false;
  if (key === "project") return isUserFacingProjectName(text);
  if (/^[A-Za-z0-9_.$:/-]+$/.test(text) && !/[가-힣]/.test(text) && !/(user|customer|lead|founder|developer|team|market|sales|support|pricing)/i.test(text)) {
    return false;
  }
  switch (key) {
  case "icp":
    return looksLikeCustomerSegment(text);
  case "outcome":
    return outcomeLikeSignal(text);
  case "goal":
    return GOAL_SIGNAL_PATTERN.test(text) || /(검증|고객|사용자|매출|시장|성공|신호|evidence|proof|prove|revenue|customer|user|market)/i.test(text);
  case "pain":
    return !looksLikeCustomerSegment(text)
      || PAIN_SIGNAL_PATTERN.test(text)
      || /(모르|모른|막혀|막힘|무엇을\s*(?:팔아야|팔지|만들어야|검증해야)|누구에게\s*팔|첫\s*사용자|데려올|불편|비용|리스크|시간|실패|manual|missing|slow|stuck)/i.test(text);
  default:
    return true;
  }
}

function looksLikeSourcePathOnly(value) {
  const text = cleanText(value);
  if (!text) return false;
  return /^(?:\.\/)?[A-Za-z0-9_.@/-]+\.(?:swift|ts|tsx|js|mjs|jsx|py|rs|go|kt|kts|md|json|toml)(?::\d+)?$/i.test(text);
}

function isUserFacingEvidenceRef(ref) {
  const normalized = normalizeEvidenceRef(ref);
  if (!normalized) return false;
  const role = evidenceRole(normalized);
  if (["goal", "icp", "spec", "readme", "source", "discovery"].includes(role)) {
    return SOURCE_SIGNAL_PATTERN.test(`${normalized.reason || ""}\n${normalized.quote || ""}`);
  }
  if (role === "manifest") {
    return /(description|customer|user|problem|mission|goal|pricing|고객|사용자|문제|목표)/i.test(normalized.quote || "");
  }
  return false;
}

function alignmentEvidenceScore(evidence = []) {
  const refs = normalizeEvidenceRefs(evidence);
  const userFacingCount = refs.filter(isUserFacingEvidenceRef).length;
  const canonicalCount = refs.filter((ref) => /canonical_doc/.test(ref.reason || "")).length;
  if (userFacingCount === 0) {
    return {
      score: refs.length ? 0.4 : 0,
      detail: refs.length ? "기술/파일 근거만 있음" : "근거 없음",
    };
  }
  return {
    score: Math.min(1.5, 0.6 + userFacingCount * 0.35 + canonicalCount * 0.15),
    detail: canonicalCount > 0 ? "문서/사용자 근거" : "사용자-facing 근거",
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return uniqueBy(value.map(cleanText).filter(Boolean), (item) => item);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function roundNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const multiplier = 10 ** Math.max(0, Number(digits) || 0);
  return Math.round(number * multiplier) / multiplier;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

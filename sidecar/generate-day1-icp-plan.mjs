import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  buildReadOnlyWorkspaceCanUseTool,
  READ_ONLY_WORKSPACE_ALLOWED_TOOLS,
} from "./read-only-workspace-tool-policy.mjs";
import { normalizeProductName } from "./onboarding-hypothesis.mjs";

export const DAY1_ICP_PLAN_SCHEMA_VERSION = 1;
export const DAY1_ALIGNMENT_PLAN_SCHEMA_VERSION = 1;
export const DAY1_SIGNAL_DIGEST_SCHEMA_VERSION = 1;
export const DAY1_ICP_PLAN_MIN_CONFIDENCE = 0.35;
export const DAY1_ALIGNMENT_PLAN_MIN_CONFIDENCE = 0.35;
export const DAY1_ICP_PLAN_DEFAULT_TIMEOUT_MS = 30_000;

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
const DAY1_ALIGNMENT_QUALITY_GATE_THRESHOLD = 7.0;
const EVIDENCE_LIMITED_LABEL = "근거 부족";
const SIGNAL_DIGEST_ROW_ORDER = Object.freeze(["project", "goal", "icp", "pain", "outcome", "evidence"]);
const SIGNAL_DIGEST_VALUE_LIMITS = Object.freeze({
  project: 90,
  goal: 120,
  icp: 90,
  pain: 80,
  outcome: 110,
  evidence: 120,
});
const USER_FACING_GENERIC_PROJECT_NAME = "이 프로젝트";
const USER_FACING_GENERIC_PAIN_POINT = "핵심 통증 확인 필요";
const USER_FACING_GENERIC_PROBLEM = "핵심 문제 확인 필요";

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
  const evidence = await collectDay1IcpEvidence({
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
  const evidence = await collectDay1IcpEvidence({
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
  now = new Date(),
  timeoutMs = DAY1_ICP_PLAN_DEFAULT_TIMEOUT_MS,
} = {}) {
  const fallback = normalizeDay1AlignmentPlan(deterministicPlan)
    || fallbackDay1AlignmentPlan({ workspaceRoot, now });

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
  const mission = cleanText(value.mission);
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
  if (looksLikeOptionDocumentPointer(label) || hasBrokenGeneratedGrammar(label)) return false;
  if (dimension === "icp") {
    return optionValue?.antiSignal === true || looksLikeCustomerSegment(label);
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
  return /(검증로|한다\.로|모른다을|다로 이어지는|\.로 이어지는|을을|를를)/.test(cleanText(value));
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
  const candidates = [
    ["README.md", "README"],
    ["readme.md", "README"],
    ["package.json", "package metadata"],
    ...Object.entries(scanResult || {})
      .filter(([, relative]) => typeof relative === "string" && relative.trim())
      .map(([role, relative]) => [relative, `${role} document`]),
  ];

  const refs = [];
  for (const [relativePath, reason] of candidates) {
    if (refs.length >= MAX_EVIDENCE_REFS) break;
    const loaded = await readWorkspaceText({ root, relativePath, fsImpl });
    if (!loaded) continue;
    refs.push({
      path: loaded.relativePath,
      reason,
      quote: evidenceQuote(loaded.content),
    });
  }

  const discoveryRefs = await collectDiscoveryFileRefs({ root, fsImpl, existing: refs });
  refs.push(...discoveryRefs.slice(0, Math.max(0, MAX_EVIDENCE_REFS - refs.length)));
  return uniqueBy(refs, (item) => item.path).slice(0, MAX_EVIDENCE_REFS);
}

async function collectDiscoveryFileRefs({ root, fsImpl, existing }) {
  const existingPaths = new Set(existing.map((item) => item.path));
  const directories = ["interviews", "interview", "transcripts", "bip", "logs", "worklog", "notes", "docs"];
  const refs = [];
  for (const directory of directories) {
    let entries = [];
    try {
      entries = await fsImpl.readdir(path.join(root, directory), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (refs.length >= 3) return refs;
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

async function readWorkspaceText({ root, relativePath, fsImpl, maxChars = MAX_DOC_CHARS }) {
  if (typeof relativePath !== "string" || !relativePath.trim()) return null;
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) return null;
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
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
}) {
  const h = onboardingHypothesis || {};
  const productName = normalizeUserFacingProjectName(h.productName) || inferProductName(workspaceRoot, evidence);
  const likelyUsers = normalizeStringArray(h.likelyUsers).slice(0, 5);
  const problem = cleanCandidateText(h.problem);
  const currentIcpGuess = cleanCandidateText(h.targetUser) || likelyUsers[0] || "";
  const confidence = cleanToken(h.confidence) || inferSignalConfidence({ evidence, currentIcpGuess, problem });
  const evidenceText = evidenceContext(evidence);
  const currentAlternatives = inferCurrentAlternatives({
    projectKind: h.projectKind,
    context: evidenceText,
    localDiscovery,
  });
  const normalizedEvidence = evidence.map(normalizeEvidenceRef).filter(Boolean).slice(0, MAX_EVIDENCE_REFS);
  const evidenceBank = buildScanEvidenceBank({
    scanResult,
    onboardingHypothesis: h,
    evidenceRefs: normalizedEvidence,
    currentAlternatives,
    localDiscovery,
  });
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

  const icpRef = roleRef("icp") || defaultRef;
  const specRef = roleRef("spec") || defaultRef;
  const goalRef = roleRef("goal") || specRef || defaultRef;
  const docsRef = roleRef("docs") || defaultRef;

  const targetUsers = uniqueCandidates([
    evidenceCandidate(h.targetUser, icpRef, "target_user"),
    ...normalizeStringArray(h.likelyUsers).map((value) =>
      evidenceCandidate(value, icpRef || docsRef, "likely_user")
    ),
  ].filter((candidate) => candidate && looksLikeCustomerSegment(candidate.value)));

  const problems = uniqueCandidates([
    evidenceCandidate(h.problem, specRef, "problem"),
    ...problemCandidatesFromText(h.purpose || h.goal, specRef || goalRef),
  ].filter(Boolean));

  const goals = uniqueCandidates([
    evidenceCandidate(h.goal, goalRef, "goal"),
    evidenceCandidate(h.purpose, goalRef || docsRef, "purpose"),
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
  }));
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
    .trim();
  if (!text || looksLikeDocumentPointer(text)) return "";
  return conciseText(text, max);
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
  const target = outcomeTargetFragment(targetUsers[0]?.value || h.targetUser || h.likelyUsers?.[0] || "첫 고객 후보");
  const problem = outcomeProblemFragment(problems[0]?.value || h.problem);
  const goalText = cleanSignalText(h.goal || goals[0]?.value || h.purpose || "");
  const lowerContext = `${goalText}\n${context}`.toLowerCase();
  const primaryRef = problems[0]?.evidenceRef || specRef || goalRef;
  const goalEvidenceRef = goals[0]?.evidenceRef || goalRef || primaryRef;

  if (problem) {
    candidates.push(evidenceCandidate(
      `${target}가 ${problem}을 이번 주 고객 대화에서 확인한다`,
      primaryRef,
      "success_signal",
    ));
  }
  if (/유료|매출|결제|가격|pricing|paid|revenue|money|\$|₩|원/.test(lowerContext)) {
    candidates.push(evidenceCandidate(
      `${target}의 지불 의향과 현재 대안을 Day 2 시장 신호로 확인한다`,
      goalEvidenceRef,
      "success_signal",
    ));
  }
  if (/사용자|user|고객|interview|인터뷰|파일럿|pilot|시장/.test(lowerContext)) {
    candidates.push(evidenceCandidate(
      `${target} 1명에게 최근 사건과 첫 사용자 획득 대안을 확인한다`,
      goalEvidenceRef,
      "success_signal",
    ));
  }
  if (candidates.length === 0) {
    candidates.push(evidenceCandidate(
      `${target}가 다음 인터뷰에서 확인할 시장 신호를 정한다`,
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
  const explicitGoal = cleanText(h.goal || h.purpose || h.businessGoal || h.business_goal);
  if (explicitGoal) return explicitGoal;

  const product = signals.productName || "이 프로젝트";
  const hasSpecificTarget = Boolean(signals.currentIcpGuess || signals.likelyUsers?.[0]);
  const hasSpecificProblem = Boolean(signals.problem);
  if (!hasSpecificTarget && !hasSpecificProblem && !(evidence?.length)) {
    return "Day 7까지 검증할 첫 고객 증거를 만든다.";
  }
  const problem = signals.problem || "현재 가장 큰 고객 문제";
  const target = signals.currentIcpGuess || signals.likelyUsers?.[0] || "첫 고객 후보";
  const evidenceHint = evidence?.[0]?.path ? ` (${evidence[0].path} 근거)` : "";
  return `${product}가 ${target}의 "${problem}" 해결을 Day 7까지 검증할 수 있는 첫 고객 증거를 만든다${evidenceHint}.`;
}

function buildAlignmentMission({ signals, projectGoal }) {
  const product = signals.productName || "이 프로젝트";
  return `${product}의 Day 1은 고정 ICP 질문지가 아니라 핵심 가설을 만드는 날입니다. 프로젝트 목표 "${projectGoal}"를 기준으로 ICP, Pain Point, Outcome을 각각 한 문장으로 압축하고 Day 2 시장 신호 검증에 넘길 품질 게이트를 확인합니다.`;
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
      title: "ICP",
      prompt: "이 목표를 위해 Day 2에서 먼저 검증할 고객은 누구인가요?",
      helperText: "직함보다 지금 같은 문제를 겪고, 이번 주에 실제로 물어볼 수 있는 고객 조건을 고릅니다.",
      statement: hasSpecificProblem
        ? `${target} 중 ${problem}을 지금 해결하려는 고객.`
        : `${target} 중 Day 2에서 먼저 검증할 고객.`,
      evidence,
      missingAssumptions: signals.currentIcpGuess ? [] : ["current_icp"],
      options: buildAlignmentIcpOptions(bank),
    },
    painPoint: {
      id: "pain_point",
      title: "Pain Point",
      prompt: "이 고객이 지금 겪는 가장 압축된 통증은 무엇인가요?",
      helperText: "좋으면 쓰는 문제가 아니라 시간, 돈, 리스크, 반복 행동으로 이미 비용이 나는 문제여야 합니다.",
      statement: problem,
      evidence,
      missingAssumptions: signals.problem ? [] : ["pain_point"],
      options: buildAlignmentPainOptions(bank),
    },
    outcome: {
      id: "outcome",
      title: "Outcome",
      prompt: "Day 2 시장 신호가 확인해야 할 고객 결과는 무엇인가요?",
      helperText: "제품 기능이 아니라 고객이 얻는 결과와 다음 검증 행동을 씁니다.",
      statement: outcome,
      evidence,
      missingAssumptions: outcome ? [] : ["outcome"],
      options: buildAlignmentOutcomeOptions(bank, outcome),
    },
  };
}

function buildOutcomeStatement({ signals, projectGoal }) {
  const target = outcomeTargetFragment(signals.currentIcpGuess || signals.likelyUsers?.[0] || "첫 고객 후보");
  const problem = outcomeProblemFragment(signals.problem || "");
  if (problem) {
    return `${target}가 ${problem}을 이번 주 고객 대화와 시장 신호로 확인한다.`;
  }
  if (!signals.currentIcpGuess && !(signals.likelyUsers?.length)) {
    return `${target}가 Day 2에서 검증할 고객 행동과 시장 신호를 정한다.`;
  }
  const goalFocus = outcomeGoalFragment(projectGoal);
  if (goalFocus) {
    return `${target}가 ${goalFocus} 기준으로 검증할 고객 행동과 시장 신호를 정한다.`;
  }
  return `${target}가 이번 주 인터뷰/시장 검증에서 확인할 행동 신호를 정한다.`;
}

function buildAlignmentStatement({ projectGoal, components }) {
  const icp = components.icp.statement;
  const painPoint = components.painPoint.statement;
  const outcome = components.outcome.statement;
  return {
    statement: `목표: ${projectGoal} / ICP: ${icp} / Pain Point: ${painPoint} / Outcome: ${outcome}`,
    projectGoal,
    icp,
    painPoint,
    outcome,
  };
}

function buildAlignmentQualityGate({ projectGoal, signals, components, evidence }) {
  const criteria = [
    qualityCriterion({
      id: "project_goal",
      label: "Project goal",
      maxScore: 2,
      score: projectGoal && !isGenericAlignmentText(projectGoal) ? 2 : 0.8,
      detail: projectGoal || "프로젝트 목표가 비어 있습니다.",
    }),
    qualityCriterion({
      id: "icp",
      label: "ICP specificity",
      maxScore: 2.5,
      score: signals.currentIcpGuess ? 2.5 : signals.likelyUsers?.length ? 1.5 : 0.5,
      detail: components.icp.statement,
    }),
    qualityCriterion({
      id: "pain_point",
      label: "Pain point",
      maxScore: 2,
      score: signals.problem ? 2 : 0.6,
      detail: components.painPoint.statement,
    }),
    qualityCriterion({
      id: "outcome",
      label: "Outcome",
      maxScore: 2,
      score: components.outcome.statement && !isGenericAlignmentText(components.outcome.statement) ? 2 : 0.8,
      detail: components.outcome.statement,
    }),
    qualityCriterion({
      id: "evidence",
      label: "Workspace evidence",
      maxScore: 1.5,
      score: Math.min(1.5, Math.max(0.4, (evidence?.length || 0) * 0.45)),
      detail: evidence?.length
        ? evidence.map((item) => item.path).slice(0, 3).join(", ")
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
    passGate: "Project Goal + ICP + Pain Point + Outcome이 담긴 핵심 가설이 7.0/10 이상이고 Day 2 시장 신호로 넘길 한 문장이 있다.",
    failGate: "목표, 고객, 통증, 결과 중 하나가 비어 있거나 founder 추측만 있고 Day 2에서 확인할 시장 신호가 없다.",
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
    "핵심 통증 확인 필요",
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
      { key: "project", label: "프로젝트", value: projectValue, tone: "strong" },
      { key: "goal", label: "목표", value: goal, tone: "body" },
      { key: "icp", label: "ICP", value: icp, tone: "body" },
      { key: "pain", label: "Pain", value: pain, tone: "mark" },
      { key: "outcome", label: "Outcome", value: outcome, tone: "strong" },
      { key: "evidence", label: "근거", value: evidence, tone: "code" },
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
      label: cleanText(row.label),
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
  const cleaned = cleanDigestDisplayText(value);
  if (cleaned && !looksLikeSignalDigestDocumentReference(value, cleaned)) {
    const normalized = conciseSignalDigestValue(key, cleaned);
    if (normalized) return normalized;
  }
  return fallbackSignalDigestValue(key, plan);
}

function fallbackSignalDigestValue(key, plan = null) {
  switch (key) {
    case "project":
      return firstUsableSignalDigestValue("project", [plan?.signals?.productName, "이 프로젝트"]);
    case "goal":
      return firstUsableSignalDigestValue("goal", [firstSentence(plan?.projectGoal), plan?.projectGoal, "목표 확인 필요"]);
    case "icp":
      return firstUsableSignalDigestValue("icp", [
        plan?.signals?.currentIcpGuess,
        plan?.alignmentStatement?.icp,
        plan?.signals?.likelyUsers?.[0],
        "첫 고객 후보 확인 필요",
      ]);
    case "pain":
      return firstUsableSignalDigestValue("pain", [plan?.signals?.problem, plan?.alignmentStatement?.painPoint, "핵심 통증 확인 필요"]);
    case "outcome":
      return firstUsableSignalDigestValue("outcome", [
        plan?.alignmentStatement?.outcome,
        conciseOutcome({ signals: plan?.signals, alignmentStatement: plan?.alignmentStatement }),
        "첫 검증 행동",
      ]);
    default:
      return "확인 필요";
  }
}

function firstUsableSignalDigestValue(key, candidates = []) {
  for (const candidate of candidates) {
    const cleaned = cleanDigestDisplayText(candidate);
    if (!cleaned || looksLikeSignalDigestDocumentReference(candidate, cleaned)) continue;
    const normalized = conciseSignalDigestValue(key, cleaned);
    if (normalized) return normalized;
  }
  return conciseSignalDigestValue(key, key === "project" ? "이 프로젝트" : "확인 필요");
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
  const raw = cleanSignalText(alignmentStatement?.outcome);
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
      "scan에서 확인된 고객 후보입니다.",
      "ICP",
    )
  );
  return ensureEvidenceBackedOptions(options, {
    fallbackLabel: "직접 입력: scan보다 더 정확한 고객 후보",
    fallbackDescription: "고객 후보 근거가 부족하면 한 줄로 보정합니다.",
    fallbackPreview: "직접 입력",
  });
}

function buildAlignmentPainOptions(bank) {
  const options = bank.problems.slice(0, 3).map((candidate) =>
    alignmentOptionFromCandidate(
      candidate,
      "scan에서 확인된 핵심 통증입니다.",
      "Pain",
    )
  );
  return ensureEvidenceBackedOptions(options, {
    fallbackLabel: "직접 입력: scan보다 더 정확한 Pain Point",
    fallbackDescription: "통증 근거가 부족하면 최근 사건/비용 기준으로 보정합니다.",
    fallbackPreview: "직접 입력",
  });
}

function buildAlignmentOutcomeOptions(bank, outcome) {
  const options = bank.successSignals.slice(0, 3).map((candidate) =>
    alignmentOptionFromCandidate(
      candidate,
      "scan 목표/통증에서 이어지는 고객 결과입니다.",
      "Outcome",
    )
  );
  if (options.length === 0 && !isGenericAlignmentText(outcome)) {
    const fallbackRef = bank.goals[0]?.evidenceRef || bank.problems[0]?.evidenceRef || bank.defaultRef;
    options.push(alignmentOptionFromCandidate(
      evidenceCandidate(outcome, fallbackRef, "outcome"),
      "목표, 고객, 통증을 결과 문장으로 연결합니다.",
      "Outcome",
    ));
  }
  return ensureEvidenceBackedOptions(options, {
    fallbackLabel: "직접 입력: Day 2가 확인할 고객 결과",
    fallbackDescription: "결과 근거가 부족하면 기능이 아니라 고객이 얻는 결과를 씁니다.",
    fallbackPreview: "직접 입력",
  });
}

function alignmentOptionFromCandidate(candidate, description, preview, antiSignal = false) {
  return alignmentOption(
    "",
    candidate.value,
    description,
    preview,
    antiSignal || candidate.evidenceLimited === true,
    optionMetadataFromCandidate(candidate),
  );
}

function ensureEvidenceBackedOptions(options, {
  fallbackLabel,
  fallbackDescription,
  fallbackPreview,
  min = 2,
  max = 4,
} = {}) {
  const cleaned = uniqueBy(
    options.filter(Boolean),
    (optionValue) => cleanText(optionValue.label).toLowerCase()
  ).slice(0, max);
  while (cleaned.length < min) {
    const index = cleaned.length + 1;
    cleaned.push(option(
      index === 1 ? fallbackLabel : "추가 scan 필요: 선택지 근거 부족",
      index === 1 ? fallbackDescription : "선택지를 자신 있게 만들 scan 근거가 아직 부족합니다.",
      index === 1 ? fallbackPreview : EVIDENCE_LIMITED_LABEL,
      index !== 1,
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
  return {
    id,
    ...option(label, description, preview, antiSignal, metadata),
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
  if (!scanResult?.icp) missing.push("icp_doc");
  if (!scanResult?.spec) missing.push("spec_doc");
  if (!scanResult?.goal) missing.push("goal_doc");
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

function buildDay1AlignmentComposerPrompt(plan) {
  return [
    "You are improving a Day 1 startup onboarding alignment plan.",
    "The new Day 1 contract is not an ICP questionnaire. It must produce one project goal and a structured alignment statement with exactly three components: ICP, Pain Point, and Outcome.",
    "Use workspace evidence. Keep the plan actionable for Day 2 market-signal validation. Do not edit files. Do not run commands.",
    "Return one JSON object only. Do not wrap it in markdown, do not include prose outside JSON, and do not repeat long source paragraphs.",
    "Preserve projectGoal, components.icp, components.painPoint, components.outcome, alignmentStatement, qualityGate, firstInterviewMessage, and day2Handoff. The quality gate is a 0-10 score and should pass at 7.0+ only when the statement is specific enough for Day 2.",
    "For components.outcome, write the customer's gained result plus an observable validation action. Do not copy the product goal, business metric, pain sentence, document pointer, or product feature as an Outcome option.",
    "Every choice label must answer its component's question directly: ICP choices are customer segments, Pain choices are customer pains/costs, Outcome choices are customer result/market-signal actions.",
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
  const title = cleanText(value.title) || alignmentComponentTitle(id);
  const prompt = cleanText(value.prompt || value.question);
  const statement = cleanText(value.statement || value.value);
  const options = Array.isArray(value.options)
    ? value.options.map((optionValue, optionIndex) =>
      normalizeQuestionOption(optionValue, optionIndex)
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

function sanitizeNormalizedAlignmentComponents(components, { signals, projectGoal } = {}) {
  if (!components) return null;
  const icp = sanitizeAlignmentFragment("icp", components.icp.statement, [
    signals?.currentIcpGuess,
    signals?.likelyUsers?.[0],
    "첫 고객 후보 확인 필요",
  ]);
  const painPoint = sanitizeAlignmentFragment("pain", components.painPoint.statement, [
    signals?.problem,
    "핵심 통증 확인 필요",
  ]);
  const outcome = sanitizeAlignmentFragment("outcome", components.outcome.statement, [
    buildOutcomeStatement({ signals: signals || {}, projectGoal }),
    "첫 검증 행동",
  ]);
  if (!icp || !painPoint || !outcome) return null;
  return {
    icp: { ...components.icp, statement: icp },
    painPoint: { ...components.painPoint, statement: painPoint },
    outcome: { ...components.outcome, statement: outcome },
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
  const outcome = sanitizeAlignmentFragment("outcome", raw.outcome, [
    components?.outcome?.statement,
    buildOutcomeStatement({ signals: signals || {}, projectGoal }),
  ]);
  const statement = resolvedProjectGoal && icp && painPoint && outcome
    ? `목표: ${resolvedProjectGoal} / ICP: ${icp} / Pain Point: ${painPoint} / Outcome: ${outcome}`
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

function sanitizeAlignmentFragment(key, value, fallbacks = []) {
  const primary = cleanAlignmentFragment(value);
  if (primary && !looksLikeAlignmentDocumentReference(value, primary)) {
    return conciseSignalDigestValue(key, primary);
  }
  for (const fallback of fallbacks) {
    const cleaned = cleanAlignmentFragment(fallback);
    if (cleaned && !looksLikeAlignmentDocumentReference(fallback, cleaned)) {
      return conciseSignalDigestValue(key, cleaned);
    }
  }
  return "";
}

function cleanAlignmentFragment(value) {
  return cleanSignalText(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .trim();
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
    return "ICP";
  case "pain_point":
    return "Pain Point";
  case "outcome":
    return "Outcome";
  default:
    return "Alignment";
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
    .map((item) => item.quote)
    .find((quote) => /^#\s+/.test(quote || ""));
  const evidenceName = normalizeUserFacingProjectName(readmeHeading?.replace(/^#+\s*/, ""))
    || evidence
      .map((item) => packageNameFromEvidence(item))
      .map(normalizeUserFacingProjectName)
      .find(Boolean);
  if (evidenceName) return evidenceName;
  const base = workspaceRoot ? path.basename(path.resolve(workspaceRoot)) : "";
  return normalizeUserFacingProjectName(base) || USER_FACING_GENERIC_PROJECT_NAME;
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
  const useful = heading || lines.find((line) => line.length >= 20) || lines[0] || "";
  return cleanText(useful).slice(0, 220);
}

function targetFragment(value) {
  const text = cleanText(value);
  if (!text) return "잠재 고객";
  return text.split(/[.,，、]/)[0].trim().slice(0, 60);
}

function outcomeTargetFragment(value) {
  const text = targetFragment(value)
    .replace(/\s+중$/g, "")
    .replace(/[.。．]+$/u, "")
    .trim();
  return text || "첫 고객 후보";
}

function problemFragment(value) {
  const text = cleanText(value);
  if (!text) return "핵심 문제";
  return text.split(/[.,，、]/)[0].trim().slice(0, 72);
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
  const text = cleanSignalText(value);
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
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

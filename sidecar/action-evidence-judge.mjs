import { runProviderStream } from "./provider-runner.mjs";
import {
  failActionVerification,
  passActionVerification,
} from "./action-day-verification-state.mjs";
import { recordActionEvidenceOutcome } from "./proof-ledger-write-through.mjs";

export const ACTION_EVIDENCE_JUDGE_SCHEMA_VERSION = 1;
export const ACTION_EVIDENCE_JUDGE_EXECUTION_MODE = "judge_read_only";

export const ACTION_EVIDENCE_JUDGE_STATUS = Object.freeze({
  accepted: "accepted",
  insufficient: "insufficient",
  error: "error",
});

const MAX_TEXT_CHARS = 4000;

export function buildActionEvidenceJudgePrompt({
  guideline = {},
  evidence = {},
  context = {},
} = {}) {
  return [
    "You are the Agentic30 action evidence judge.",
    "Evaluate only the submitted evidence against the parsed curriculum guideline object.",
    "Do not invent off-screen actions. If the evidence does not demonstrate the completion signal, mark it insufficient.",
    "Return strict JSON only with keys: status, confidence, agent_assessment, criterion_results, missing_elements, mini_action_suggestion.",
    "",
    "Allowed status values:",
    "- accepted: evidence satisfies the completion signal and all required sufficiency criteria.",
    "- insufficient: evidence is relevant but does not yet satisfy the guideline.",
    "",
    "Criterion result shape:",
    "- type: one of quantity, quality, evidence, timebox, completion, or unknown.",
    "- label: short criterion label.",
    "- passed: boolean.",
    "- reason: concise reason grounded in submitted evidence.",
    "",
    "Parsed guideline object:",
    JSON.stringify(normalizeGuideline(guideline), null, 2),
    "",
    "Submitted evidence:",
    JSON.stringify(normalizeEvidence(evidence), null, 2),
    "",
    "Additional context, not scoring evidence unless it is explicitly referenced by the submitted evidence:",
    JSON.stringify(normalizePlainObject(context), null, 2),
  ].join("\n");
}

export async function judgeActionEvidence({
  guideline = {},
  evidence = {},
  context = {},
  provider = process.env.AGENTIC30_ACTION_EVIDENCE_JUDGE_PROVIDER || "codex",
  model = process.env.AGENTIC30_ACTION_EVIDENCE_JUDGE_MODEL || "",
  workspaceRoot = process.cwd(),
  timeoutMs = 120_000,
  runJudge = runActionEvidenceJudgeProvider,
  now = () => new Date(),
} = {}) {
  const prompt = buildActionEvidenceJudgePrompt({ guideline, evidence, context });

  try {
    const rawOutput = await runJudge({
      prompt,
      guideline: normalizeGuideline(guideline),
      evidence: normalizeEvidence(evidence),
      context: normalizePlainObject(context),
      provider,
      model,
      workspaceRoot,
      timeoutMs,
    });
    const parsed = parseActionEvidenceJudgeJson(rawOutput);
    const judgedAt = now().toISOString();
    return {
      schemaVersion: ACTION_EVIDENCE_JUDGE_SCHEMA_VERSION,
      schema: "agentic30.curriculum.action_evidence_judge.v1",
      status: parsed.status,
      passed: parsed.status === ACTION_EVIDENCE_JUDGE_STATUS.accepted,
      confidence: parsed.confidence,
      agentAssessment: parsed.agentAssessment,
      agent_assessment: parsed.agentAssessment,
      criterionResults: parsed.criterionResults,
      criterion_results: parsed.criterionResults,
      missingElements: parsed.missingElements,
      missing_elements: parsed.missingElements,
      miniActionSuggestion: parsed.miniActionSuggestion,
      mini_action_suggestion: parsed.miniActionSuggestion,
      guidelineSnapshot: normalizeGuideline(guideline),
      guideline_snapshot: normalizeGuideline(guideline),
      evidenceSnapshot: normalizeEvidence(evidence),
      evidence_snapshot: normalizeEvidence(evidence),
      judgedAt,
      judged_at: judgedAt,
      rawJudgeOutput: String(rawOutput || ""),
      raw_judge_output: String(rawOutput || ""),
    };
  } catch (error) {
    const message = error?.message || String(error);
    const judgedAt = now().toISOString();
    return {
      schemaVersion: ACTION_EVIDENCE_JUDGE_SCHEMA_VERSION,
      schema: "agentic30.curriculum.action_evidence_judge.v1",
      status: ACTION_EVIDENCE_JUDGE_STATUS.error,
      passed: false,
      confidence: 0,
      agentAssessment: `Evidence judge unavailable or invalid: ${message}`,
      agent_assessment: `Evidence judge unavailable or invalid: ${message}`,
      criterionResults: [],
      criterion_results: [],
      missingElements: ["judge_unavailable"],
      missing_elements: ["judge_unavailable"],
      miniActionSuggestion: "증거를 한 번 더 확인하고, 완료 신호가 보이는 링크나 파일을 제출해보세요.",
      mini_action_suggestion: "증거를 한 번 더 확인하고, 완료 신호가 보이는 링크나 파일을 제출해보세요.",
      guidelineSnapshot: normalizeGuideline(guideline),
      guideline_snapshot: normalizeGuideline(guideline),
      evidenceSnapshot: normalizeEvidence(evidence),
      evidence_snapshot: normalizeEvidence(evidence),
      judgedAt,
      judged_at: judgedAt,
      rawJudgeOutput: "",
      raw_judge_output: "",
    };
  }
}

export async function completeActionEvidenceWithJudge(inputState, {
  guideline = {},
  evidence = null,
  context = {},
  provider,
  model,
  workspaceRoot,
  timeoutMs,
  runJudge = runActionEvidenceJudgeProvider,
  // Optional proof-ledger write-through target (spec §15.1). When set,
  // terminal verdicts (accepted/insufficient) are persisted; judge errors
  // are never written (spec §21: hold, not a verdict).
  proofLedger = null,
  now = () => new Date(),
} = {}) {
  const evidenceSubmission = evidence || inputState?.evidenceSubmission || {};
  const judgment = await judgeActionEvidence({
    guideline,
    evidence: evidenceSubmission,
    context,
    provider,
    model,
    workspaceRoot,
    timeoutMs,
    runJudge,
    now,
  });
  const proofLedgerEvent = await writeJudgeOutcomeThrough({
    proofLedger,
    guideline,
    judgment,
    evidence: evidenceSubmission,
    now,
  });

  if (judgment.passed) {
    const state = passActionVerification(inputState, {
      confidence: judgment.confidence,
      agentAssessment: judgment.agentAssessment,
      evidenceSubmission,
      raw: judgment,
      now,
    });
    return {
      status: ACTION_EVIDENCE_JUDGE_STATUS.accepted,
      judgment,
      proofLedgerEvent,
      state: markEvidenceValidationStatus(state, "accepted"),
    };
  }

  const state = failActionVerification(inputState, {
    reason: judgment.status === ACTION_EVIDENCE_JUDGE_STATUS.error
      ? "Evidence judge could not complete."
      : "Submitted evidence does not satisfy the action guideline.",
    agentAssessment: judgment.agentAssessment,
    evidenceSubmission,
    raw: judgment,
    now,
  });
  return {
    status: judgment.status,
    judgment,
    proofLedgerEvent,
    state: markEvidenceValidationStatus(state, "rejected"),
  };
}

async function writeJudgeOutcomeThrough({ proofLedger, guideline, judgment, evidence, now }) {
  if (!proofLedger?.workspaceRoot) return null;
  try {
    const result = await recordActionEvidenceOutcome({
      workspaceRoot: proofLedger.workspaceRoot,
      day: proofLedger.day ?? guideline?.dayId ?? guideline?.day_id ?? null,
      actionId: proofLedger.actionId ?? guideline?.actionId ?? guideline?.action_id ?? "",
      judgment,
      evidence,
      guideline,
      now: typeof now === "function" ? now() : now,
      ...(proofLedger.append ? { append: proofLedger.append } : {}),
    });
    return result?.event ?? null;
  } catch {
    // Write-through failure must not lose the judge verdict; the caller
    // still receives the judgment and in-memory state.
    return null;
  }
}

export async function runActionEvidenceJudgeProvider({
  prompt,
  provider = process.env.AGENTIC30_ACTION_EVIDENCE_JUDGE_PROVIDER || "codex",
  model = process.env.AGENTIC30_ACTION_EVIDENCE_JUDGE_MODEL || "",
  workspaceRoot = process.cwd(),
  timeoutMs = 120_000,
  runProvider = runProviderStream,
} = {}) {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  let rawOutput = "";

  try {
    await runProvider({
      provider,
      prompt,
      model,
      workspaceRoot,
      abortController,
      executionMode: ACTION_EVIDENCE_JUDGE_EXECUTION_MODE,
      onTextDelta: (chunk) => {
        rawOutput += String(chunk || "");
      },
      onTextReplace: (text) => {
        rawOutput = String(text || "");
      },
    });
    return rawOutput;
  } finally {
    clearTimeout(timer);
  }
}

export function parseActionEvidenceJudgeJson(raw) {
  const payload = extractJsonPayload(String(raw || ""));
  const parsed = JSON.parse(payload);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Judge response must be a JSON object.");
  }

  const status = normalizeJudgeStatus(parsed.status ?? parsed.verdict ?? parsed.outcome);
  const criterionResults = normalizeCriterionResults(
    parsed.criterion_results ?? parsed.criterionResults,
  );
  const requiredFailures = criterionResults.filter((result) => result.required !== false && !result.passed);
  if (status === ACTION_EVIDENCE_JUDGE_STATUS.accepted && requiredFailures.length > 0) {
    throw new Error("Accepted judge response cannot include failed required criteria.");
  }

  return {
    status,
    confidence: clampNumber(parsed.confidence ?? parsed.score ?? 0, 0, 1),
    agentAssessment: requiredString(
      parsed.agent_assessment ?? parsed.agentAssessment ?? parsed.assessment,
      "agent_assessment",
    ),
    criterionResults,
    missingElements: normalizeStringList(parsed.missing_elements ?? parsed.missingElements),
    miniActionSuggestion: trimText(
      parsed.mini_action_suggestion ?? parsed.miniActionSuggestion ?? "",
      1000,
    ),
  };
}

function normalizeJudgeStatus(value) {
  const text = trimText(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["accepted", "accept", "pass", "passed", "verified"].includes(text)) {
    return ACTION_EVIDENCE_JUDGE_STATUS.accepted;
  }
  if (["insufficient", "reject", "rejected", "fail", "failed", "not_enough"].includes(text)) {
    return ACTION_EVIDENCE_JUDGE_STATUS.insufficient;
  }
  throw new Error("Judge response status must be accepted or insufficient.");
}

function normalizeCriterionResults(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Judge response must include non-empty criterion_results.");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`criterion_results[${index}] must be an object.`);
    }
    const type = trimText(item.type || "unknown", 80).toLowerCase().replace(/[\s-]+/g, "_") || "unknown";
    return {
      type,
      label: trimText(item.label || type, 120),
      description: trimText(item.description || "", 1000),
      required: item.required === false ? false : true,
      passed: Boolean(item.passed),
      reason: requiredString(item.reason, `criterion_results[${index}].reason`),
    };
  });
}

function extractJsonPayload(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Judge response was empty.");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function normalizeGuideline(input = {}) {
  const criteria = Array.isArray(input?.sufficiencyCriteria)
    ? input.sufficiencyCriteria
    : Array.isArray(input?.sufficiency_criteria)
      ? input.sufficiency_criteria
      : [];
  return {
    schemaVersion: input?.schemaVersion ?? input?.schema_version ?? null,
    dayId: normalizeInteger(input?.dayId ?? input?.day_id),
    actionId: trimText(input?.actionId ?? input?.action_id),
    actionType: trimText(input?.actionType ?? input?.action_type),
    goal: trimText(input?.goal),
    keyQuestion: trimText(input?.keyQuestion ?? input?.key_question),
    intent: trimText(input?.intent),
    actionDescription: trimText(input?.actionDescription ?? input?.action_description),
    completionSignal: trimText(input?.completionSignal ?? input?.completion_signal),
    sufficiencyCriteria: criteria.map((criterion) => ({
      type: trimText(criterion?.type || "completion", 80),
      label: trimText(criterion?.label || "", 120),
      description: trimText(criterion?.description || "", 1000),
      required: criterion?.required === false ? false : true,
    })),
    verificationMethods: normalizeStringList(input?.verificationMethods ?? input?.verification_methods),
    evidenceFallback: normalizePlainObject(input?.evidenceFallback ?? input?.evidence_fallback),
    dependencies: normalizeStringList(input?.dependencies ?? input?.dependency_refs),
  };
}

function normalizeEvidence(input = {}) {
  return {
    type: trimText(input?.type),
    content: trimText(input?.content, MAX_TEXT_CHARS),
    note: trimText(input?.note, 1000),
    submittedAt: trimText(input?.submittedAt ?? input?.submitted_at),
    validationStatus: trimText(input?.validationStatus ?? input?.validation_status),
  };
}

function markEvidenceValidationStatus(state, validationStatus) {
  if (!state?.evidenceSubmission) return state;
  return {
    ...state,
    evidenceSubmission: {
      ...state.evidenceSubmission,
      validationStatus,
    },
  };
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, normalizeJsonValue(entryValue)]),
  );
}

function normalizeJsonValue(value) {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (typeof value === "object") return normalizePlainObject(value);
  if (typeof value === "string") return trimText(value, MAX_TEXT_CHARS);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function normalizeStringList(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s*,\s*|\s+\|\s+|\n/)
      : [];
  return [...new Set(items.map((item) => trimText(item, 500)).filter(Boolean))];
}

function requiredString(value, field) {
  const text = trimText(value, 2000);
  if (!text) throw new Error(`Judge response must include ${field}.`);
  return text;
}

function trimText(value, max = MAX_TEXT_CHARS) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeInteger(value) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

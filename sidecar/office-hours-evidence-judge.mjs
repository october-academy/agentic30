import fs from "node:fs/promises";
import path from "node:path";
import { runProviderStream } from "./provider-runner.mjs";
import { officeHoursEvidenceHasHardEvidence } from "./office-hours-evidence-state.mjs";

export const OFFICE_HOURS_HARD_EVIDENCE_MISSING_DEBT = "hard_evidence_missing";

export const OFFICE_HOURS_EVIDENCE_JUDGE_SCHEMA_VERSION = 1;
export const OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE = 8;
export const OFFICE_HOURS_EVIDENCE_JUDGE_EXECUTION_MODE = "judge_read_only";

const DOC_TYPES = Object.freeze(["goal", "icp", "values", "spec"]);
const MAX_DOC_CHARS = 7_000;
const MAX_CONTEXT_CHARS = 24_000;

export function buildOfficeHoursEvidenceJudgePrompt({
  evidenceState = {},
  documents = {},
  bestPracticeDocs = {},
} = {}) {
  return [
    "You are the Agentic30 Office Hours evidence document judge.",
    "Judge whether regenerated local runtime docs are strong enough to become canonical under `.agentic30/docs/`.",
    "Score only from the submitted docs, next question, and local evidence state. Do not infer missing facts.",
    `Passing threshold: score >= ${OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE}/10.`,
    "",
    "Quality contract:",
    "- GOAL must contain a 30-day mission, measurement contract, threshold/deadline, failure condition, and evidence debt.",
    "- ICP must define a behavior/situation customer, current alternatives, pressure cost, and strong Anti-ICP/exclusion reasons.",
    "- SPEC must contain requirements grounded in evidence links, core loop, MVP scope, out-of-scope, and success signal.",
    "- VALUES must be stable product values; conflicts should be explicit rather than silently rewriting principles.",
    "- The next question must be sharper than a generic discovery question and must target the weakest customer/market evidence.",
    "",
    "Return strict JSON only with keys: score, passed, summary, criteria, follow_up_questions, evidence_debt.",
    "Criteria item shape: { id, passed, reason }.",
    "",
    "Best-practice reference docs from tracked `docs/*` (style/quality reference, not source of truth):",
    redactSecrets(JSON.stringify(normalizeDocuments(bestPracticeDocs), null, 2)).slice(0, MAX_CONTEXT_CHARS),
    "",
    "Reducer evidence state:",
    redactSecrets(JSON.stringify(normalizeEvidenceStateForPrompt(evidenceState), null, 2)).slice(0, MAX_CONTEXT_CHARS),
    "",
    "Generated local runtime docs:",
    redactSecrets(JSON.stringify(normalizeDocuments(documents), null, 2)).slice(0, MAX_CONTEXT_CHARS),
  ].join("\n");
}

export async function judgeOfficeHoursEvidenceDocuments({
  provider = process.env.AGENTIC30_OFFICE_HOURS_DOC_JUDGE_PROVIDER || "codex",
  model = process.env.AGENTIC30_OFFICE_HOURS_DOC_JUDGE_MODEL || "",
  workspaceRoot = process.cwd(),
  evidenceState = {},
  documents = {},
  timeoutMs = 120_000,
  runJudge = runOfficeHoursEvidenceJudgeProvider,
  now = () => new Date(),
} = {}) {
  if (shouldUseDeterministicJudge(provider)) {
    return applyHardEvidenceGate(
      deterministicOfficeHoursEvidenceJudge({ evidenceState, documents, now }),
      evidenceState,
    );
  }

  const bestPracticeDocs = await readBestPracticeDocs(workspaceRoot);
  const prompt = buildOfficeHoursEvidenceJudgePrompt({ evidenceState, documents, bestPracticeDocs });
  const judgedAt = toIso(now());
  try {
    const rawOutput = await runJudge({
      prompt,
      provider,
      model,
      workspaceRoot,
      timeoutMs,
    });
    const parsed = parseOfficeHoursEvidenceJudgeJson(rawOutput);
    return applyHardEvidenceGate({
      schemaVersion: OFFICE_HOURS_EVIDENCE_JUDGE_SCHEMA_VERSION,
      schema: "agentic30.office_hours.evidence_judge.v1",
      status: parsed.passed ? "passed" : "failed",
      passed: parsed.passed,
      score: parsed.score,
      summary: parsed.summary,
      criteria: parsed.criteria,
      followUpQuestions: parsed.followUpQuestions,
      follow_up_questions: parsed.followUpQuestions,
      evidenceDebt: parsed.evidenceDebt,
      evidence_debt: parsed.evidenceDebt,
      judgedAt,
      judged_at: judgedAt,
      provider,
      model,
      rawJudgeOutput: String(rawOutput || ""),
      raw_judge_output: String(rawOutput || ""),
    }, evidenceState);
  } catch (error) {
    const message = error?.message || String(error);
    // Route the infra-error result through the gate too, so it records the
    // hard-evidence debt when applicable; the gate preserves status "error".
    return applyHardEvidenceGate(errorJudgeResult({
      provider,
      model,
      judgedAt,
      message: `Office Hours evidence judge unavailable or invalid: ${message}`,
      evidenceDebt: ["judge_unavailable"],
    }), evidenceState);
  }
}

export async function runOfficeHoursEvidenceJudgeProvider({
  prompt,
  provider = process.env.AGENTIC30_OFFICE_HOURS_DOC_JUDGE_PROVIDER || "codex",
  model = process.env.AGENTIC30_OFFICE_HOURS_DOC_JUDGE_MODEL || "",
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
      executionMode: OFFICE_HOURS_EVIDENCE_JUDGE_EXECUTION_MODE,
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

export function parseOfficeHoursEvidenceJudgeJson(raw) {
  const payload = extractJsonPayload(String(raw || ""));
  const parsed = JSON.parse(payload);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Judge response must be a JSON object.");
  }
  const score = clampNumber(parsed.score ?? parsed.quality_score, 0, 10);
  const criteria = normalizeCriteria(parsed.criteria ?? parsed.criterion_results);
  if (!criteria.length) {
    throw new Error("Judge response must include non-empty criteria.");
  }
  const requiredFailures = criteria.filter((item) => item.required !== false && !item.passed);
  const passed = Boolean(parsed.passed) && score >= OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE && requiredFailures.length === 0;
  return {
    score,
    passed,
    summary: trimText(parsed.summary ?? parsed.assessment, 1200),
    criteria,
    followUpQuestions: normalizeStringList(parsed.follow_up_questions ?? parsed.followUpQuestions).slice(0, 2),
    evidenceDebt: normalizeStringList(parsed.evidence_debt ?? parsed.evidenceDebt),
  };
}

export function deterministicOfficeHoursEvidenceJudge({
  evidenceState = {},
  documents = {},
  now = () => new Date(),
} = {}) {
  const normalizedDocs = normalizeDocuments(documents);
  const facts = evidenceState?.facts || {};
  const debts = normalizeStringList(evidenceState?.evidenceDebt);
  const criteria = [
    criterion("goal_measurement_contract", docHasAll(normalizedDocs.goal, [facts.metric, facts.threshold, facts.failureCondition]), "GOAL has metric, threshold/deadline, and failure condition."),
    criterion("goal_evidence_debt", /증거부채|남은\s*가정|실패\s*조건/.test(normalizedDocs.goal), "GOAL exposes evidence debt or unresolved assumptions."),
    criterion("icp_behavior_situation", docIncludes(normalizedDocs.icp, facts.targetUser) && docIncludes(normalizedDocs.icp, facts.currentAlternative), "ICP names the customer situation and current alternative."),
    criterion("icp_pressure_and_anti_icp", docIncludes(normalizedDocs.icp, facts.pressureCost) && /제외|Anti|넓은\s*고객|자동화\s*확장/.test(normalizedDocs.icp), "ICP includes pressure cost and exclusion reasons."),
    criterion("spec_entry_and_loop", docIncludes(normalizedDocs.spec, facts.entryPoint) && docIncludes(normalizedDocs.spec, facts.activationAction || facts.nextAction), "SPEC grounds the core loop in entry point and activation action."),
    criterion("spec_scope", /MVP|범위|만들지\s*않을|out-of-scope|제외/.test(normalizedDocs.spec), "SPEC states MVP scope and out-of-scope."),
    criterion("values_stability", /가치|원칙|사용자\s*행동\s*증거|증거를\s*우선/.test(normalizedDocs.values), "VALUES declares stable product values."),
    criterion("next_question", isSharpNextQuestion(evidenceState?.nextQuestion, facts), "Next question targets the weakest customer/market evidence."),
  ];
  const passedCount = criteria.filter((item) => item.passed).length;
  const score = Math.max(0, Math.min(10, Number((2 + passedCount).toFixed(1))));
  const passed = score >= OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE && criteria.every((item) => item.passed);
  const judgedAt = toIso(now());
  return {
    schemaVersion: OFFICE_HOURS_EVIDENCE_JUDGE_SCHEMA_VERSION,
    schema: "agentic30.office_hours.evidence_judge.v1",
    status: passed ? "passed" : "failed",
    passed,
    score,
    summary: passed
      ? "Reducer evidence restored the missing measurement contract, customer/market evidence, scope, and next question."
      : "Generated docs still miss required Office Hours evidence roles.",
    criteria,
    followUpQuestions: buildDeterministicFollowUps({ facts, debts: debts.length ? debts : criteria.filter((item) => !item.passed).map((item) => item.reason) }),
    follow_up_questions: buildDeterministicFollowUps({ facts, debts: debts.length ? debts : criteria.filter((item) => !item.passed).map((item) => item.reason) }),
    evidenceDebt: debts,
    evidence_debt: debts,
    judgedAt,
    judged_at: judgedAt,
    provider: "deterministic",
    model: "",
    rawJudgeOutput: "",
    raw_judge_output: "",
  };
}

// GATE-01 + ER-1: a verdict only counts as passed when the underlying evidence
// includes at least one hard-evidence turn (real transaction or completed
// behavior). New/Day0 sessions (empty references) and self-report-only sessions
// both fail here, regardless of the doc text or the provider-reported score.
// Infra errors (status==="error") keep their own status but record the debt.
function applyHardEvidenceGate(result, evidenceState) {
  if (!result) return result;
  // P1-1: split the verdict into three orthogonal facts so "doc is good but
  // there is no hard evidence" is distinguishable from "the doc itself is below
  // bar". Promotion to canonical `.agentic30/docs/` requires BOTH. These are
  // additive — the legacy status/passed/score contract is unchanged below.
  const hardEvidenceSatisfied = officeHoursEvidenceHasHardEvidence(evidenceState);
  // docQualityPassed = the judge's OWN doc-quality verdict, read before the gate
  // caps it. An infra error cannot assert doc quality.
  const docQualityPassed = result.status === "error" ? false : Boolean(result.passed);
  const canonicalizationAllowed = docQualityPassed && hardEvidenceSatisfied;
  const splitFields = { docQualityPassed, hardEvidenceSatisfied, canonicalizationAllowed };

  if (hardEvidenceSatisfied) return { ...result, ...splitFields };
  const debt = appendJudgeDebt(result.evidenceDebt, OFFICE_HOURS_HARD_EVIDENCE_MISSING_DEBT);
  // Infra errors keep their own status/score (0); only record the debt.
  if (result.status === "error") {
    return { ...result, ...splitFields, evidenceDebt: debt, evidence_debt: debt };
  }
  // Any non-error verdict without hard evidence is forced to a failed save with
  // a capped score, so we never leave a "10/10 but blocked" contradiction.
  const cappedScore = Math.min(clampNumber(result.score, 0, 10), OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE - 1);
  return {
    ...result,
    ...splitFields,
    status: "failed",
    passed: false,
    score: cappedScore,
    summary: trimText(
      `${result.summary || ""} 하드 증거 없음: 결제·계약·완료 행동 기록이 evidence에 없어 자기보고만으로는 통과할 수 없습니다.`,
      1200,
    ),
    evidenceDebt: debt,
    evidence_debt: debt,
  };
}

function appendJudgeDebt(list, item) {
  const arr = normalizeStringList(list);
  return arr.includes(item) ? arr : [...arr, item];
}

function shouldUseDeterministicJudge(provider) {
  const mode = String(process.env.AGENTIC30_OFFICE_HOURS_DOC_JUDGE_MODE || "").trim().toLowerCase();
  return mode === "deterministic"
    || process.env.AGENTIC30_TEST_STUB_PROVIDER === "1"
    || String(provider || "").trim().toLowerCase() === "deterministic";
}

async function readBestPracticeDocs(workspaceRoot) {
  const root = path.resolve(workspaceRoot || ".");
  const files = {
    goal: "docs/GOAL.md",
    icp: "docs/ICP.md",
    spec: "docs/SPEC.md",
    values: "docs/VALUES.md",
  };
  const entries = await Promise.all(Object.entries(files).map(async ([type, rel]) => {
    try {
      const content = await fs.readFile(path.join(root, rel), "utf8");
      return [type, content.slice(0, MAX_DOC_CHARS)];
    } catch {
      return [type, ""];
    }
  }));
  return Object.fromEntries(entries);
}

function normalizeEvidenceStateForPrompt(evidenceState = {}) {
  return {
    schemaVersion: evidenceState.schemaVersion ?? null,
    generatedAt: evidenceState.generatedAt || "",
    confidence: evidenceState.confidence ?? 0,
    facts: evidenceState.facts || {},
    evidenceDebt: normalizeStringList(evidenceState.evidenceDebt),
    nextQuestion: trimText(evidenceState.nextQuestion, 1200),
    references: Array.isArray(evidenceState.references)
      ? evidenceState.references.slice(0, 40)
      : [],
  };
}

function normalizeDocuments(documents = {}) {
  const source = documents && typeof documents === "object" && !Array.isArray(documents) ? documents : {};
  return Object.fromEntries(DOC_TYPES.map((type) => [type, trimText(source[type], MAX_DOC_CHARS)]));
}

function normalizeCriteria(value) {
  const items = Array.isArray(value) ? value : [];
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`criteria[${index}] must be an object.`);
    }
    const id = trimText(item.id ?? item.type ?? `criterion_${index + 1}`, 120);
    return {
      id,
      passed: item.passed === true,
      required: item.required === false ? false : true,
      reason: requiredString(item.reason, `criteria[${index}].reason`),
    };
  });
}

function criterion(id, passed, reason) {
  return { id, passed: Boolean(passed), required: true, reason };
}

function docHasAll(doc, values) {
  return values.every((value) => docIncludes(doc, value));
}

function docIncludes(doc, value) {
  const wanted = trimText(value);
  if (!wanted) return false;
  const text = String(doc || "").replace(/\s+/g, " ").toLowerCase();
  if (!text) return false;
  const wantedLower = wanted.toLowerCase();
  // Strongest signal: the doc grounds the fact as a verbatim phrase. The Day1
  // handoff renderer interpolates these fact strings directly into the docs,
  // so a real grounding always satisfies this branch.
  if (wantedLower.length >= 2 && text.includes(wantedLower)) return true;
  // Otherwise demand more than a lone token. The previous `.some` let a single
  // 2-char token satisfy a whole criterion, which produced false-positive
  // passes against shallow docs.
  const allWords = wantedLower
    .split(/[\s,./·()"'`]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  if (!allWords.length) return false;
  // Numeral/quantifier tokens (e.g. "1회", "3명에게") are the discriminating
  // part of a measurement or entry-point contract. A bare majority vote lets a
  // shallow doc drop exactly these while matching only generic words, so every
  // digit-bearing token of the fact must be present.
  if (allWords.some((word) => /\d/.test(word) && !text.includes(word))) return false;
  // Plus a strict majority of the (capped) meaningful tokens.
  const words = allWords.slice(0, 8);
  const matched = words.filter((word) => text.includes(word)).length;
  return matched * 2 > words.length;
}

function isSharpNextQuestion(nextQuestion, facts = {}) {
  const text = trimText(nextQuestion);
  if (!text) return false;
  return /증거|돈|시간|현재\s*대안|약속|결제|유료|고객|시장/.test(text)
    && (docIncludes(text, facts.currentAlternative) || docIncludes(text, facts.targetUser) || /약속|증거부채/.test(text));
}

function buildDeterministicFollowUps({ facts = {}, debts = [] } = {}) {
  const target = trimText(facts.targetUser) || "가장 절박한 고객 후보";
  const alternative = trimText(facts.currentAlternative) || "현재 대안";
  const firstDebt = debts[0] || "가장 약한 고객/시장 증거";
  return [
    `${target}이 ${alternative}에 최근 2주 동안 실제로 쓴 돈이나 시간은 얼마인가요?`,
    `${firstDebt}를 오늘 확인하려면 실명 고객 1명에게 어떤 문장으로 물어봐야 하나요?`,
  ].slice(0, 2);
}

function errorJudgeResult({ provider, model, judgedAt, message, evidenceDebt }) {
  return {
    schemaVersion: OFFICE_HOURS_EVIDENCE_JUDGE_SCHEMA_VERSION,
    schema: "agentic30.office_hours.evidence_judge.v1",
    status: "error",
    passed: false,
    score: 0,
    summary: message,
    criteria: [],
    followUpQuestions: buildDeterministicFollowUps({ debts: evidenceDebt }),
    follow_up_questions: buildDeterministicFollowUps({ debts: evidenceDebt }),
    evidenceDebt,
    evidence_debt: evidenceDebt,
    judgedAt,
    judged_at: judgedAt,
    provider,
    model,
    rawJudgeOutput: "",
    raw_judge_output: "",
  };
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

function normalizeStringList(value) {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === "string" && value.includes("\n") ? value.split(/\n+/) : (value ? [value] : []));
  return raw.map((item) => trimText(item, 1000)).filter(Boolean);
}

function requiredString(value, label) {
  const text = trimText(value, 1200);
  if (!text) throw new Error(`Judge response must include ${label}.`);
  return text;
}

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function trimText(value, max = 4000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function toIso(value) {
  const raw = typeof value === "function" ? value() : value;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function redactSecrets(text) {
  return String(text || "")
    .replace(/("(?:api[_-]?key|token|secret|password|authorization)"\s*:\s*")([^"]+)(")/gi, "$1[REDACTED]$3")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g, "[REDACTED_SECRET]");
}

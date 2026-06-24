import fs from "node:fs/promises";
import path from "node:path";
import { projectDocPath } from "./project-doc-paths.mjs";
import { dedupeOfficeHoursTurnsKeepLast } from "./office-hours-resume.mjs";

export const OFFICE_HOURS_EVIDENCE_SCHEMA_VERSION = 1;
export const OFFICE_HOURS_EVIDENCE_SCHEMA = "agentic30.office_hours.evidence.v1";

const DOC_TYPES = Object.freeze(["goal", "icp", "values", "spec"]);
const MAX_REFS = 40;

export async function buildOfficeHoursEvidenceState({
  workspaceRoot,
  day1Handoff = {},
  fsImpl = fs,
  now = () => new Date(),
} = {}) {
  const root = path.resolve(workspaceRoot || ".");
  const [turnLog, ledger, dailyDigest, proofLedger] = await Promise.all([
    readJson(fsImpl, path.join(root, ".agentic30", "memory", "office-hours-turns.json")),
    readJson(fsImpl, path.join(root, ".agentic30", "memory", "office-hours-ledger.json")),
    readJson(fsImpl, path.join(root, ".agentic30", "office-hours-daily-digest.json")),
    readJson(fsImpl, path.join(root, ".agentic30", "proof-ledger.json")),
  ]);
  const turns = normalizeTurns(turnLog?.turns);
  const commitments = normalizeCommitments(ledger?.commitments);
  const handoffFacts = normalizeHandoffFacts(day1Handoff);
  const facts = deriveEvidenceFacts({
    turns,
    commitments,
    dailyDigest,
    handoffFacts,
  });
  const references = buildReferences({
    turns,
    commitments,
    dailyDigest,
    proofPaymentRefs: normalizeProofLedgerPaymentRefs(proofLedger),
  });
  const evidenceDebt = uniqueStrings([
    ...deriveEvidenceDebt({ facts, turns, commitments, dailyDigest }),
    ...facts.assumptions,
  ]).slice(0, 12);
  const nextQuestion = buildNextQuestion({ facts, evidenceDebt, commitments });
  const generatedAt = toIso(now());
  const confidence = scoreEvidenceConfidence({ facts, turns, commitments, evidenceDebt });

  return {
    schemaVersion: OFFICE_HOURS_EVIDENCE_SCHEMA_VERSION,
    schema: OFFICE_HOURS_EVIDENCE_SCHEMA,
    generatedAt,
    source: "office_hours_reducer",
    confidence,
    facts,
    evidenceDebt,
    references,
    nextQuestion,
    judge: null,
    docs: Object.fromEntries(DOC_TYPES.map((type) => [type, projectDocPath(type)])),
  };
}

export function mergeDay1HandoffWithEvidence(day1Handoff = {}, evidenceState = null) {
  const source = normalizeHandoffFacts(day1Handoff);
  const facts = evidenceState?.facts || {};
  const first = (...values) => values.map(cleanText).find(Boolean) || "";
  return {
    ...source,
    ...facts,
    northStarGoal: first(facts.northStarGoal, source.northStarGoal, source.goal),
    weeklyProof: first(facts.weeklyProof, source.weeklyProof, source.entryPoint, source.nextAction),
    targetUser: first(facts.targetUser, source.targetUser, source.icp),
    problem: first(facts.problem, source.problem, source.pain),
    currentAlternative: first(facts.currentAlternative, source.currentAlternative),
    entryPoint: first(facts.entryPoint, source.entryPoint),
    nextAction: first(facts.nextAction, source.nextAction, source.outcome),
    metric: first(facts.metric, source.metric),
    threshold: first(facts.threshold, source.threshold),
    failureCondition: first(facts.failureCondition, source.failureCondition),
    pressureCost: first(facts.pressureCost, source.pressureCost),
    activationAction: first(facts.activationAction, source.activationAction),
    nonGoals: uniqueStrings([...(facts.nonGoals || []), ...(source.nonGoals || [])]),
    assumptions: uniqueStrings([
      ...(facts.assumptions || []),
      ...(source.assumptions || []),
      ...(evidenceState?.evidenceDebt || []),
    ]),
    sourceQuotes: uniqueStrings([...(facts.sourceQuotes || []), ...(source.sourceQuotes || [])]),
    evidenceDebt: uniqueStrings(evidenceState?.evidenceDebt || facts.evidenceDebt || []),
    nextQuestion: evidenceState?.nextQuestion || facts.nextQuestion || "",
  };
}

export function buildOfficeHoursEvidenceSidecar(doc, evidenceState, {
  judgeResult = null,
} = {}) {
  const docType = String(doc?.type || "");
  const facts = evidenceState?.facts || {};
  const docReferences = (evidenceState?.references || [])
    .filter((ref) => shouldReferenceDoc(docType, ref))
    .slice(0, MAX_REFS);
  return {
    schemaVersion: OFFICE_HOURS_EVIDENCE_SCHEMA_VERSION,
    schema: "agentic30.office_hours.evidence_doc.v1",
    docType,
    docPath: doc?.canonicalPath || projectDocPath(docType),
    generatedAt: evidenceState?.generatedAt || new Date().toISOString(),
    confidence: evidenceState?.confidence ?? 0,
    facts,
    evidenceDebt: evidenceState?.evidenceDebt || [],
    localReferences: docReferences,
    nextQuestion: evidenceState?.nextQuestion || "",
    lastJudgeResult: judgeResult || evidenceState?.judge || null,
  };
}

export async function writeOfficeHoursEvidenceSidecar(workspaceRoot, doc, evidenceState, {
  judgeResult = null,
  fsImpl = fs,
} = {}) {
  if (!doc?.canonicalPath || !evidenceState) return null;
  const target = path.join(path.resolve(workspaceRoot || "."), evidenceSidecarPath(doc.canonicalPath));
  await fsImpl.mkdir(path.dirname(target), { recursive: true });
  const sidecar = buildOfficeHoursEvidenceSidecar(doc, evidenceState, { judgeResult });
  await fsImpl.writeFile(target, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
  return sidecar;
}

export async function writeOfficeHoursEvidenceDebtReport(workspaceRoot, evidenceState, {
  judgeResult = null,
  fsImpl = fs,
} = {}) {
  if (!evidenceState) return null;
  const root = path.resolve(workspaceRoot || ".");
  const target = path.join(root, ".agentic30", "docs", "OFFICE_HOURS_EVIDENCE_DEBT.json");
  await fsImpl.mkdir(path.dirname(target), { recursive: true });
  const payload = {
    schemaVersion: OFFICE_HOURS_EVIDENCE_SCHEMA_VERSION,
    schema: "agentic30.office_hours.evidence_debt_report.v1",
    generatedAt: evidenceState.generatedAt || new Date().toISOString(),
    source: evidenceState.source || "office_hours_reducer",
    confidence: evidenceState.confidence ?? 0,
    evidenceDebt: uniqueStrings([
      ...(evidenceState.evidenceDebt || []),
      ...(judgeResult?.evidenceDebt || judgeResult?.evidence_debt || []),
    ]),
    nextQuestion: evidenceState.nextQuestion || "",
    references: evidenceState.references || [],
    lastJudgeResult: judgeResult || evidenceState.judge || null,
  };
  await fsImpl.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export function evidenceSidecarPath(markdownPath = "") {
  const text = String(markdownPath || "");
  return text.endsWith(".md") ? text.replace(/\.md$/i, ".evidence.json") : `${text}.evidence.json`;
}

export function renderOfficeHoursEvidenceDebtCard(evidenceState = {}) {
  const debts = Array.isArray(evidenceState.evidenceDebt) ? evidenceState.evidenceDebt : [];
  const next = cleanText(evidenceState.nextQuestion);
  if (!debts.length && !next) return "";
  return [
    "증거부채",
    ...debts.slice(0, 5).map((item) => `- ${item}`),
    next ? `다음 질문: ${next}` : "",
  ].filter(Boolean).join("\n");
}

function normalizeTurns(value) {
  // IDEM-1: dedupe raw turns first (resume re-seeds the same question on every
  // relaunch). Without this, duplicate turns inflate reference counts and the
  // confidence score (turns.length >= 4) even though no new evidence arrived.
  const deduped = dedupeOfficeHoursTurnsKeepLast(Array.isArray(value) ? value : []);
  return deduped
    .map((turn, index) => normalizeTurn(turn, index))
    .filter(Boolean);
}

function normalizeTurn(turn, index) {
  if (!turn || typeof turn !== "object") return null;
  const firstQuestion = Array.isArray(turn.promptSnapshot?.questions)
    ? turn.promptSnapshot.questions[0]
    : null;
  const selectedLabel = Array.isArray(turn.submissions?.[0]?.selectedOptions)
    ? String(turn.submissions[0].selectedOptions[0] || "")
    : String(turn.responseText || "");
  const selectedOption = findSelectedOption(firstQuestion, selectedLabel);
  return {
    id: cleanText(turn.id) || `turn-${index + 1}`,
    day: integerOrNull(turn.day),
    sessionId: cleanText(turn.sessionId),
    requestId: cleanText(turn.requestId),
    occurredAt: cleanText(turn.occurredAt),
    signalId: cleanText(turn.signalId || turn.promptSnapshot?.generation?.signalId),
    signalLabel: cleanText(turn.signalLabel || turn.promptSnapshot?.generation?.signalLabel),
    questionId: cleanText(firstQuestion?.questionId || firstQuestion?.question_id),
    header: cleanText(firstQuestion?.header),
    questionText: cleanText(turn.questionText || firstQuestion?.question),
    responseText: cleanText(turn.responseText || selectedLabel),
    responseDescription: cleanText(turn.responseDescription),
    freeText: cleanText(turn.submissions?.[0]?.freeText),
    selectedOption: selectedOption ? normalizeOption(selectedOption) : null,
    terminal: turn.terminal === true,
  };
}

function normalizeOption(option) {
  return {
    label: cleanText(option.label),
    description: cleanText(option.description),
    recommended: option.recommended === true,
    risk: cleanText(option.risk),
    evidenceTarget: cleanText(option.evidenceTarget || option.evidence_target),
    mapsTo: cleanText(option.mapsTo || option.maps_to),
    failureMode: cleanText(option.failureMode || option.failure_mode),
    nextIntent: cleanText(option.nextIntent || option.next_intent),
  };
}

function findSelectedOption(question, label) {
  const wanted = cleanText(label);
  const options = Array.isArray(question?.options) ? question.options : [];
  return options.find((option) => cleanText(option?.label) === wanted) || null;
}

function normalizeCommitments(value) {
  return (Array.isArray(value) ? value : [])
    .map((commitment, index) => ({
      id: cleanText(commitment?.id) || `commitment-${index + 1}`,
      cycle: integerOrNull(commitment?.cycle),
      createdDay: integerOrNull(commitment?.createdDay),
      createdAt: cleanText(commitment?.createdAt),
      text: cleanText(commitment?.text),
      status: cleanText(commitment?.status) || "open",
      evidence: cleanText(commitment?.evidence),
      dueDay: integerOrNull(commitment?.dueDay),
      confirmedByUser: commitment?.confirmedByUser === true,
    }))
    .filter((item) => item.text);
}

function deriveEvidenceFacts({ turns, commitments, dailyDigest, handoffFacts }) {
  const activeUserTurn = findTurn(turns, {
    questionId: "get_users_active_user_definition",
    text: /활성\s*사용자|핵심\s*행동/,
  });
  const targetTurn = findTurn(turns, {
    questionId: /known_dev_first_segment|desperate_segment/,
    mapsTo: /ICP\.desperate_segment/i,
    text: /첫\s*10명|가장\s*절실한|고객\s*후보.*누구|누구.*고객\s*후보/,
  });
  const channelTurn = findTurn(turns, {
    questionId: /first_channel|first_reach/,
    mapsTo: /ICP\.first_reach_channel/i,
    text: /어디에서|직접\s*만날|고객\s*접점/,
  });
  const alternativeTurn = findTurn(turns, {
    questionId: /current_alternative|status_quo/,
    mapsTo: /PROBLEM\.status_quo/i,
    text: /현재\s*대안|버티/,
  });
  const activationTurn = findTurn(turns.filter((turn) => turn.id !== activeUserTurn?.id), {
    questionId: /activation|first_value|observed_action/,
    mapsTo: /GOAL\.activation_action/i,
    text: /검증\s*행동|반드시\s*끝내야/,
  });
  const entryTurn = findTurn(turns, {
    questionId: /entry|offer|wedge|paid/,
    mapsTo: /SPEC\.smallest_paid_entry/i,
    text: /작은\s*유료\s*진입점|돈을\s*낼|유료/,
  });
  const marketSignalTurn = findTurn([...turns].reverse(), {
    text: /외부\s*시장\s*신호|실명\s*고객\s*3명|유료\s*검증/,
  });
  const latestOpenCommitment = [...commitments].reverse().find((item) => item.status === "open");
  const latestCommitment = latestOpenCommitment || commitments[commitments.length - 1] || null;

  const targetUser = firstText(
    targetTurn?.responseText,
    handoffFacts.targetUser,
    handoffFacts.icp,
  );
  const currentAlternative = firstText(
    alternativeTurn?.responseText,
    handoffFacts.currentAlternative,
  );
  const activationAction = firstText(
    activationTurn?.responseText,
    activeUserTurn?.responseText,
  );
  const entryPoint = firstText(entryTurn?.responseText, handoffFacts.entryPoint);
  const nextAction = firstText(
    latestCommitment?.text,
    handoffFacts.nextAction,
    activationAction,
  );
  const firstReach = firstText(channelTurn?.responseText);
  const activeDefinition = firstText(activeUserTurn?.responseText);

  const problem = firstText(
    isWeakHandoffPlaceholder(handoffFacts.problem) ? "" : handoffFacts.problem,
    currentAlternative
      ? `${currentAlternative}. 기능 개발 시간은 늘지만 고객 접촉과 유료 검증이 비어 첫 매출 검증이 막힌다.`
      : "",
  );
  const weeklyProof = firstText(
    handoffFacts.weeklyProof,
    buildWeeklyProof({ targetUser, entryPoint, activationAction, marketSignal: marketSignalTurn?.responseText }),
  );
  const metric = firstText(
    handoffFacts.metric,
    buildMetric({ activeDefinition, activationAction, marketSignal: marketSignalTurn?.responseText }),
  );
  const threshold = firstText(
    handoffFacts.threshold,
    buildThreshold({ targetUser, entryPoint, activationAction }),
  );
  const failureCondition = firstText(
    handoffFacts.failureCondition,
    marketSignalTurn?.selectedOption?.failureMode,
    entryTurn?.selectedOption?.failureMode,
    activationTurn?.selectedOption?.failureMode,
    activeUserTurn?.selectedOption?.failureMode,
  );
  const pressureCost = firstText(
    alternativeTurn?.selectedOption?.evidenceTarget,
    "최근 2주 기능 개발 시간과 고객 대화 수로 압박 비용을 확인한다.",
  );

  const sourceQuotes = uniqueStrings([
    targetTurn && `고객 후보: ${targetTurn.responseText}`,
    alternativeTurn && `현재 대안: ${alternativeTurn.responseText}`,
    activationTurn && `첫 가치 행동: ${activationTurn.responseText}`,
    entryTurn && `작은 유료 진입점: ${entryTurn.responseText}`,
    marketSignalTurn && `외부 시장 신호: ${marketSignalTurn.responseText}`,
  ]).slice(0, 10);

  return {
    northStarGoal: firstText(
      handoffFacts.northStarGoal,
      handoffFacts.goal,
      dailyDigest?.briefing?.goalStatus?.[0],
      "30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다.",
    ),
    weeklyProof,
    metric,
    threshold,
    failureCondition,
    targetUser,
    firstReach,
    problem,
    currentAlternative,
    pressureCost,
    activationAction,
    entryPoint,
    nextAction,
    activeDefinition,
    nonGoals: uniqueStrings([
      ...(handoffFacts.nonGoals || []),
      "넓은 고객 후보",
      "자동화 확장",
      "여러 고객 유형 확장",
      "고객 행동 증거 전 제품 내 유료 잠금 기능 구현",
    ]),
    assumptions: uniqueStrings([
      ...(handoffFacts.assumptions || []),
      !targetUser && "고객 후보가 행동 상황 기준으로 충분히 좁혀지지 않았다.",
      !currentAlternative && "현재 대안과 압박 비용이 확인되지 않았다.",
      !entryPoint && "작은 유료 진입점이 확인되지 않았다.",
      !failureCondition && "실패 판정 조건이 확인되지 않았다.",
    ]),
    sourceQuotes,
  };
}

function buildWeeklyProof({ targetUser, entryPoint, activationAction, marketSignal }) {
  const who = targetUser || "고객 후보 1명";
  const entry = entryPoint || "1회 검증 세션";
  const action = marketSignal || activationAction || "첫 가치 완료";
  return `${who}이 ${entry}에서 ${action}까지 끝내는지 확인한다.`;
}

function buildMetric({ activeDefinition, activationAction, marketSignal }) {
  const parts = uniqueStrings([
    activeDefinition ? `${activeDefinition} 완료 수` : "",
    activationAction ? `${activationAction} 완료 여부` : "",
    marketSignal ? `${marketSignal} 증거` : "",
    "유료 진행 또는 지불 의향 여부",
  ]);
  return parts.join(", ");
}

function buildThreshold({ targetUser, entryPoint, activationAction }) {
  const who = targetUser ? `${targetUser} 1명 이상` : "고객 후보 1명 이상";
  const entry = entryPoint || "1회 검증 세션";
  const action = activationAction || "첫 가치 완료";
  return `이번 주까지 ${who}이 ${entry}에서 ${action}을 끝낸다.`;
}

function deriveEvidenceDebt({ facts, turns, commitments, dailyDigest }) {
  const debts = [];
  if (!facts.targetUser) debts.push("행동 상황 기준 고객 후보를 한 문장으로 좁혀야 한다.");
  if (!facts.firstReach) debts.push("이번 주 직접 닿을 채널과 후보 수를 확인해야 한다.");
  if (!facts.currentAlternative) debts.push("현재 대안과 돈/시간 비용을 확인해야 한다.");
  if (!facts.pressureCost || /확인/.test(facts.pressureCost)) debts.push("최근 2주 기능 개발 시간과 고객 대화 수를 숫자로 확인해야 한다.");
  if (!facts.entryPoint) debts.push("작은 유료 진입점과 가격/결제 시점을 확인해야 한다.");
  if (!facts.activationAction) debts.push("첫 가치 완료로 인정할 사용자 행동을 확인해야 한다.");
  if (!facts.failureCondition) debts.push("이번 cycle 실패 조건을 확인해야 한다.");
  if (!commitments.some((item) => item.status === "open")) debts.push("다음 office-hours에서 추적할 열린 약속이 없다.");
  if (dailyDigest?.buildWithoutCustomerEvidence === true) debts.push("빌드가 고객 증거 없이 진행됐는지 확인해야 한다.");
  if (!turns.some((turn) => /유료|결제|지불/.test([turn.questionText, turn.responseText, turn.responseDescription].join(" ")))) {
    debts.push("돈 신호가 아직 약하다. 가격, 결제, 유료 진행 반응을 확인해야 한다.");
  }
  return debts;
}

function buildNextQuestion({ facts, evidenceDebt, commitments }) {
  const latest = [...(commitments || [])].reverse().find((item) => item.status === "open");
  const debt = evidenceDebt?.[0] || "가장 약한 고객/시장 증거";
  const target = facts.targetUser || "가장 절박한 고객 후보";
  const alternative = facts.currentAlternative || "현재 대안";
  if (latest?.text) {
    return `지난 약속 "${latest.text}"의 확인 가능한 증거는 무엇이고, ${target}이 지금 쓰는 ${alternative}에는 돈이나 시간이 얼마나 들어가나요?`;
  }
  return `${target}이 ${alternative}으로 버티는 비용을 숫자로 말할 수 있나요? 지금 가장 큰 증거부채는 "${debt}"입니다.`;
}

// ER-1 / GATE-01: hard evidence = the Q1 Demand-Reality grades that mean a real
// transaction or a concrete purchase commitment. CRITICALLY, the active-user
// *definition* grades (first_value_completed / repeat_use_completed /
// manual_pilot_success) are NOT hard evidence — they answer "what counts as an
// active user" (a definition), not proof that anyone completed it. Likewise
// "verbal_interest_or_no_evidence" (self-report) and "paid_or_time_current_alternative"
// (status-quo problem signal) are excluded. Only demand-evidence turns qualify;
// the sourceType check below pins this to real office-hours turns, not commitments
// or digests. Tune as the bar evolves; demand evidence stays canonical while
// active-user definition options are adaptive to project context.
export const OFFICE_HOURS_HARD_EVIDENCE_INTENTS = Object.freeze([
  "actual_payment_or_contract",
  "concrete_purchase_conditions",
]);

// The locked Day 1 get_users cards (active-user definition + the candidate →
// alternative → request → evidence-format → commitment ladder) now generate their
// option metadata adaptively, so a model could emit a hard-evidence nextIntent
// (e.g. actual_payment_or_contract) on a card that is only a definition or a plan,
// not a real transaction. These slots are excluded from hard-evidence detection
// regardless of the LLM-authored nextIntent. Every other turn (Q1 demand evidence,
// paid-entry wedge, etc.) keeps the canonical nextIntent-based detection.
const OFFICE_HOURS_NON_HARD_EVIDENCE_SIGNALS = Object.freeze(new Set([
  "get_users_active_user_definition",
  "get_users_first_candidate",
  "get_users_current_alternative",
  "get_users_today_request",
  "get_users_evidence_format",
  "get_users_day1_commitment",
]));

// Graduated pressure: early cycles pass on the ladder intent alone; once the
// program reaches this cycle, a real payment_record artifact must also back the
// docs. Tune as October moves the "now we demand payment" point. Trigger uses
// commitment `cycle` only — NOT `day` (a turn can be logged on calendar day 2
// of cycle 1, so a day threshold would misfire on first-cycle users).
export const OFFICE_HOURS_ARTIFACT_GATE_MIN_CYCLE = 3;

export function officeHoursEvidenceHasHardEvidence(evidenceState = {}) {
  const refs = Array.isArray(evidenceState?.references) ? evidenceState.references : [];
  const hard = new Set(OFFICE_HOURS_HARD_EVIDENCE_INTENTS);
  // Exclude the adaptive Day 1 get_users slots so an LLM-authored nextIntent on a
  // definition/plan card cannot be miscounted as a real transaction; trust the
  // canonical nextIntent on every other turn. signalId is carried on the turn ref
  // (see the office_hours_turn references above).
  const hasLadderHard = refs.some((ref) =>
    ref?.sourceType === "office_hours_turn"
    && !OFFICE_HOURS_NON_HARD_EVIDENCE_SIGNALS.has(cleanText(ref?.signalId))
    && hard.has(cleanText(ref?.nextIntent)));
  const isPastEarlyCycle = refs.some((ref) =>
    Number.isInteger(ref?.cycle) && ref.cycle >= OFFICE_HOURS_ARTIFACT_GATE_MIN_CYCLE);
  if (!isPastEarlyCycle) return hasLadderHard;
  const hasStrongPayment = refs.some((ref) =>
    ref?.sourceType === "proof_ledger" && cleanText(ref?.strength) === "strong");
  return hasLadderHard && hasStrongPayment;
}

// artifact gate (proof-ledger cross-check): only a real payment_record that
// upstream already marked verified/accepted AND strong counts as a hard-evidence
// artifact. payment_intent is excluded on purpose — inferProofStrength
// (execution-os.mjs:914-924) stamps any payment_intent "strong" regardless of
// status, which would let "agreed a price but never charged" pass as hard
// evidence. strength is read, never recomputed (trust upstream). Read-only +
// graceful: a missing/corrupt proof-ledger yields [].
const OFFICE_HOURS_ARTIFACT_PAYMENT_STATUSES = Object.freeze(["verified", "accepted"]);

function normalizeProofLedgerPaymentRefs(proofLedger) {
  const events = Array.isArray(proofLedger?.events) ? proofLedger.events : [];
  const refs = [];
  for (const event of events) {
    const type = cleanText(event?.type ?? event?.eventType ?? event?.event_type).toLowerCase();
    if (type !== "payment_record") continue;
    const status = cleanText(event?.status ?? event?.validationStatus ?? event?.validation_status).toLowerCase();
    if (!OFFICE_HOURS_ARTIFACT_PAYMENT_STATUSES.includes(status)) continue;
    const strength = cleanText(event?.strength ?? event?.proofStrength ?? event?.proof_strength).toLowerCase();
    if (strength !== "strong") continue;
    refs.push({
      sourceType: "proof_ledger",
      id: cleanText(event?.id) || `proof-payment-${refs.length + 1}`,
      day: integerOrNull(event?.day ?? event?.dayNumber ?? event?.day_number),
      kind: "payment_record",
      status,
      strength: "strong",
    });
  }
  return refs;
}

function buildReferences({ turns, commitments, dailyDigest, proofPaymentRefs = [] }) {
  const refs = [];
  for (const turn of turns) {
    refs.push({
      sourceType: "office_hours_turn",
      id: turn.id,
      day: turn.day,
      sessionId: turn.sessionId,
      requestId: turn.requestId,
      questionId: turn.questionId,
      signalId: turn.signalId,
      question: turn.questionText,
      response: turn.responseText,
      mapsTo: turn.selectedOption?.mapsTo || "",
      risk: turn.selectedOption?.risk || "",
      evidenceTarget: turn.selectedOption?.evidenceTarget || "",
      failureMode: turn.selectedOption?.failureMode || "",
      // ER-1: keep the structured-input evidence ladder grade and the user's
      // free text so the judge can tell hard evidence from self-report instead
      // of only seeing that some text exists.
      nextIntent: turn.selectedOption?.nextIntent || "",
      freeText: turn.freeText || "",
      occurredAt: turn.occurredAt,
    });
  }
  for (const commitment of commitments) {
    refs.push({
      sourceType: "office_hours_commitment",
      id: commitment.id,
      day: commitment.createdDay,
      cycle: commitment.cycle,
      text: commitment.text,
      status: commitment.status,
      dueDay: commitment.dueDay,
      createdAt: commitment.createdAt,
    });
  }
  if (dailyDigest?.generatedAt) {
    refs.push({
      sourceType: "daily_digest",
      id: "office-hours-daily-digest",
      day: integerOrNull(dailyDigest.day),
      generatedAt: cleanText(dailyDigest.generatedAt),
      biggestEvidenceGap: normalizeStringList(dailyDigest.briefing?.biggestEvidenceGap).join(" "),
    });
  }
  for (const ref of proofPaymentRefs) refs.push(ref);
  return refs.slice(0, MAX_REFS);
}

function scoreEvidenceConfidence({ facts, turns, commitments, evidenceDebt }) {
  let score = 0.35;
  if (turns.length >= 4) score += 0.18;
  if (commitments.length >= 1) score += 0.1;
  for (const key of ["targetUser", "currentAlternative", "entryPoint", "activationAction", "failureCondition", "threshold"]) {
    if (cleanText(facts[key])) score += 0.06;
  }
  score -= Math.min(0.18, (evidenceDebt?.length || 0) * 0.015);
  return Math.max(0, Math.min(0.95, Number(score.toFixed(2))));
}

function shouldReferenceDoc(docType, ref) {
  const text = [
    ref?.sourceType,
    ref?.questionId,
    ref?.signalId,
    ref?.mapsTo,
    ref?.question,
    ref?.response,
  ].filter(Boolean).join(" ").toLowerCase();
  if (docType === "goal") return /goal|activation|active|활성|첫\s*가치|목표|약속|commitment|digest/.test(text);
  if (docType === "icp") return /icp|customer|고객|대안|접점|segment|후보/.test(text);
  if (docType === "spec") return /spec|entry|wedge|paid|진입점|유료|흐름|시장\s*신호/.test(text);
  if (docType === "values") return /non|risk|failure|리스크|실패|포기|위반|대안/.test(text);
  return true;
}

function findTurn(turns, { questionId = null, mapsTo = null, text = null } = {}) {
  return turns.find((turn) => {
    if (matches(turn.questionId, questionId) || matches(turn.signalId, questionId)) return true;
    if (matches(turn.selectedOption?.mapsTo, mapsTo)) return true;
    const haystack = [
      turn.header,
      turn.questionText,
      turn.responseText,
      turn.responseDescription,
      turn.selectedOption?.mapsTo,
    ].join(" ");
    return matches(haystack, text);
  }) || null;
}

function matches(value, pattern) {
  if (!pattern) return false;
  const text = String(value || "");
  if (pattern instanceof RegExp) return pattern.test(text);
  return text === String(pattern);
}

function isWeakHandoffPlaceholder(value = "") {
  return /첫\s*고객\s*후보|검증할\s*문제|이번\s*주\s*확인할\s*행동|확인\s*필요/.test(String(value || ""));
}

function normalizeHandoffFacts(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const first = (...keys) => {
    for (const key of keys) {
      const text = cleanText(source[key]);
      if (text) return text;
    }
    return "";
  };
  return {
    goal: first("goal"),
    icp: first("icp"),
    pain: first("pain"),
    outcome: first("outcome"),
    northStarGoal: first("northStarGoal", "north_star_goal"),
    weeklyProof: first("weeklyProof", "weekly_proof", "proof", "validationAction", "validation_action"),
    targetUser: first("targetUser", "target_user", "customer"),
    problem: first("problem", "pain"),
    currentAlternative: first("currentAlternative", "current_alternative", "statusQuo", "status_quo"),
    entryPoint: first("entryPoint", "entry_point", "wedge"),
    nextAction: first("nextAction", "next_action", "outcome"),
    metric: first("metric"),
    threshold: first("threshold"),
    failureCondition: first("failureCondition", "failure_condition"),
    pressureCost: first("pressureCost", "pressure_cost"),
    activationAction: first("activationAction", "activation_action"),
    nonGoals: normalizeStringList(source.nonGoals ?? source.non_goals),
    assumptions: normalizeStringList(source.assumptions),
    sourceQuotes: normalizeStringList(source.sourceQuotes ?? source.source_quotes),
    markdown: first("markdown"),
  };
}

async function readJson(fsImpl, target) {
  try {
    return JSON.parse(await fsImpl.readFile(target, "utf8"));
  } catch {
    return null;
  }
}

function normalizeStringList(value) {
  const raw = Array.isArray(value)
    ? value
    : (typeof value === "string" && value.includes("\n") ? value.split(/\n+/) : (value ? [value] : []));
  return raw.map(cleanText).filter(Boolean);
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = cleanText(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function firstText(...values) {
  return values.map(cleanText).find(Boolean) || "";
}

function cleanText(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).join(", ");
  return String(value || "").replace(/\s+/g, " ").trim();
}

function integerOrNull(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function toIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

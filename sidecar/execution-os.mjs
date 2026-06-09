import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import { resolveAgentic30Dir } from "./news-market-radar.mjs";
import { evaluateCurriculumProgressionGate } from "./curriculum-progression-gate.mjs";
import { getFoundationValueContract } from "./foundation-contracts.mjs";
import { resolveActionEvidenceInputMode } from "./action-day-evidence-submission.mjs";

export const EXECUTION_OS_SCHEMA_VERSION = 1;
export const PROOF_LEDGER_SCHEMA_VERSION = 1;
export const DAILY_MISSION_CARD_SCHEMA_VERSION = 1;
export const PILOT_READINESS_SCHEMA_VERSION = 1;
export const EXECUTION_OS_METRICS_SCHEMA_VERSION = 1;

export const PROOF_EVENT_TYPES = Object.freeze({
  setup: "setup",
  mission: "mission",
  interview: "interview",
  bip: "bip",
  workLog: "work_log",
  dmAsk: "dm_ask",
  landingMetric: "landing_metric",
  paymentIntent: "payment_intent",
  actionEvidence: "action_evidence",
  dayDecision: "day_decision",
  referral: "referral",
});

const PROOF_EVENT_TYPE_VALUES = new Set(Object.values(PROOF_EVENT_TYPES));
const PROOF_EVENT_STATUSES = new Set([
  "draft",
  "submitted",
  "accepted",
  "verified",
  "rejected",
  "insufficient",
  "blocked",
  "complete",
  "completed",
]);
const COMPLETED_PROOF_STATUSES = new Set(["accepted", "verified", "complete", "completed"]);
const SUBMITTED_PROOF_STATUSES = new Set([...COMPLETED_PROOF_STATUSES, "submitted"]);
const PROOF_STRENGTHS = new Set(["weak", "medium", "strong"]);
const DECISIONS = new Set(["continue", "pivot", "stop", "restart"]);
const EVENT_LIMIT = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveProofLedgerPath(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "proof-ledger.json");
}

export function makeDefaultProofLedger(now = new Date()) {
  const generatedAt = toIso(now);
  return {
    schemaVersion: PROOF_LEDGER_SCHEMA_VERSION,
    schema_version: PROOF_LEDGER_SCHEMA_VERSION,
    schema: "agentic30.proof_ledger.v1",
    createdAt: generatedAt,
    created_at: generatedAt,
    updatedAt: generatedAt,
    updated_at: generatedAt,
    events: [],
  };
}

export async function loadProofLedger({ workspaceRoot, fsImpl = fs } = {}) {
  if (!workspaceRoot) return makeDefaultProofLedger();
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveProofLedgerPath(workspaceRoot), "utf8"));
    return normalizeProofLedger(raw);
  } catch {
    return makeDefaultProofLedger();
  }
}

export async function saveProofLedger({ workspaceRoot, ledger, now = new Date() } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("saveProofLedger requires workspaceRoot.");
  }
  const filePath = resolveProofLedgerPath(workspaceRoot);
  const normalized = normalizeProofLedger(ledger, { now });
  return withFileLock(filePath, async () => {
    await atomicWriteJson(filePath, normalized);
    return normalized;
  });
}

export async function appendProofLedgerEvent({ workspaceRoot, event, now = new Date() } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("appendProofLedgerEvent requires workspaceRoot.");
  }
  const filePath = resolveProofLedgerPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const current = await loadProofLedger({ workspaceRoot });
    const normalizedEvent = normalizeProofEvent(event, {
      now,
      index: current.events.length,
    });
    const next = normalizeProofLedger({
      ...current,
      updatedAt: toIso(now),
      events: [...current.events, normalizedEvent],
    }, { now });
    await atomicWriteJson(filePath, next);
    return {
      ledger: next,
      event: normalizedEvent,
    };
  });
}

export function normalizeProofLedger(value = {}, { now = new Date() } = {}) {
  const raw = objectOrEmpty(value);
  const fallback = makeDefaultProofLedger(now);
  const createdAt = normalizeIsoDate(raw.createdAt ?? raw.created_at, fallback.createdAt);
  const events = asArray(raw.events)
    .map((event, index) => normalizeProofEvent(event, { now, index }))
    .filter(Boolean)
    .slice(-EVENT_LIMIT);
  const updatedAt = normalizeIsoDate(
    raw.updatedAt ?? raw.updated_at,
    events.at(-1)?.createdAt ?? fallback.updatedAt,
  );
  return {
    schemaVersion: PROOF_LEDGER_SCHEMA_VERSION,
    schema_version: PROOF_LEDGER_SCHEMA_VERSION,
    schema: "agentic30.proof_ledger.v1",
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
    events,
  };
}

export function normalizeProofEvent(value = {}, { now = new Date(), index = 0 } = {}) {
  const raw = objectOrEmpty(value);
  if (!Object.keys(raw).length) return null;
  const eventType = normalizeToken(raw.type ?? raw.eventType ?? raw.event_type);
  const type = PROOF_EVENT_TYPE_VALUES.has(eventType) ? eventType : PROOF_EVENT_TYPES.actionEvidence;
  const statusToken = normalizeToken(raw.status ?? raw.validationStatus ?? raw.validation_status);
  const status = PROOF_EVENT_STATUSES.has(statusToken) ? statusToken : "submitted";
  const strengthToken = normalizeToken(raw.strength ?? raw.proofStrength ?? raw.proof_strength);
  const strength = PROOF_STRENGTHS.has(strengthToken) ? strengthToken : inferProofStrength({ type, status });
  const createdAt = normalizeIsoDate(raw.createdAt ?? raw.created_at ?? raw.timestamp, now.toISOString());
  const day = normalizeDay(raw.day ?? raw.dayNumber ?? raw.day_number);
  const decision = normalizeDecision(raw.decision ?? raw.goNoGoDecision ?? raw.go_no_go_decision);
  const title = cleanString(raw.title ?? raw.label ?? defaultProofEventTitle(type, index), 180);
  const summary = redactInlineSecrets(cleanString(raw.summary ?? raw.note ?? raw.content ?? "", 1000));
  const evidenceType = normalizeEvidenceType(raw.evidenceType ?? raw.evidence_type);
  const metadata = sanitizeProofMetadata(raw.metadata ?? raw.properties ?? {});
  return {
    id: cleanString(raw.id, 120) || `proof-${randomUUID()}`,
    type,
    eventType: type,
    event_type: type,
    status,
    strength,
    day,
    createdAt,
    created_at: createdAt,
    title,
    summary,
    customer: redactInlineSecrets(cleanString(raw.customer ?? raw.person ?? raw.targetCustomer, 180)),
    channel: cleanString(raw.channel ?? raw.sourceChannel ?? raw.source_channel, 80),
    actionId: cleanString(raw.actionId ?? raw.action_id, 160),
    action_id: cleanString(raw.actionId ?? raw.action_id, 160),
    evidenceType,
    evidence_type: evidenceType,
    source: cleanString(raw.source, 120),
    sourceUrl: cleanProofUrl(raw.sourceUrl ?? raw.source_url ?? raw.url),
    source_url: cleanProofUrl(raw.sourceUrl ?? raw.source_url ?? raw.url),
    artifactPath: cleanProofPath(raw.artifactPath ?? raw.artifact_path ?? raw.path),
    artifact_path: cleanProofPath(raw.artifactPath ?? raw.artifact_path ?? raw.path),
    decision,
    amount: normalizeAmount(raw.amount),
    currency: cleanString(raw.currency, 12).toUpperCase(),
    polarity: normalizePolarity(raw.polarity ?? metadata.polarity),
    refs: normalizeStringArray(raw.refs ?? raw.evidenceRefs ?? raw.evidence_refs, 20, 260),
    metadata,
  };
}

export function buildDailyMissionCard({
  day = 1,
  curriculumDay = null,
  day1GoalSelection = null,
  projectContext = null,
  proofLedger = null,
  now = new Date(),
} = {}) {
  const dayNumber = normalizeDay(day) ?? normalizeDay(curriculumDay?.day ?? curriculumDay?.dayId) ?? 1;
  const ledger = normalizeProofLedger(proofLedger ?? makeDefaultProofLedger(now), { now });
  const contract = dayNumber >= 1 && dayNumber <= 7
    ? getFoundationValueContract(dayNumber)
    : null;
  const targetCustomer = cleanString(
    day1GoalSelection?.customer
      ?? projectContext?.targetUser
      ?? projectContext?.target_user
      ?? projectContext?.customer
      ?? "",
    220,
  );
  const problem = cleanString(
    day1GoalSelection?.problem
      ?? projectContext?.problem
      ?? "",
    260,
  );
  const validationAction = cleanString(
    day1GoalSelection?.validationAction
      ?? day1GoalSelection?.validation_action
      ?? projectContext?.purpose
      ?? projectContext?.validationAction
      ?? "",
    420,
  );
  const hasGoal = Boolean(targetCustomer && problem && validationAction);
  const actionText = hasGoal
    ? validationAction
    : dayNumber === 0
      ? "워크스페이스를 선택하고 첫 고객, 문제, 증거 위치를 고정한다."
      : "고객 후보 1명을 고르고 과거 행동 질문 1개를 오늘 보낸다.";
  const evidenceMode = resolveActionEvidenceInputMode({
    type: missionEvidenceActionType(dayNumber, actionText),
    description: actionText,
    expectedEvidenceTypes: inferExpectedEvidenceTypes(dayNumber, actionText),
  });
  const artifact = contract?.evidenceArtifact
    ?? (dayNumber === 0 ? ".agentic30/proof-ledger.json" : "고객 행동 증거 링크 또는 로컬 파일");
  const deadlineAt = new Date(dateFrom(now).getTime() + DAY_MS).toISOString();
  const recentEvidenceRefs = ledger.events
    .slice(-5)
    .map((event) => event.id)
    .filter(Boolean);
  const sourceEvidenceRefs = [
    ...normalizeStringArray(day1GoalSelection?.evidenceRefs ?? day1GoalSelection?.evidence_refs, 8, 260),
    ...recentEvidenceRefs,
  ].slice(0, 12);

  return {
    schemaVersion: DAILY_MISSION_CARD_SCHEMA_VERSION,
    schema_version: DAILY_MISSION_CARD_SCHEMA_VERSION,
    schema: "agentic30.execution_os.daily_mission_card.v1",
    componentType: "execution_os_daily_mission_card",
    component_type: "execution_os_daily_mission_card",
    uiPlacement: "above_chat_primary",
    ui_placement: "above_chat_primary",
    cardRole: "primary_execution_surface",
    card_role: "primary_execution_surface",
    providerRequired: false,
    provider_required: false,
    localFallbackAvailable: true,
    local_fallback_available: true,
    generatedAt: toIso(now),
    generated_at: toIso(now),
    day: dayNumber,
    title: dayNumber === 0 ? "Day 0 setup mission" : `Day ${dayNumber} mission`,
    targetCustomer: targetCustomer || "아직 고정되지 않은 첫 ICP 후보",
    target_customer: targetCustomer || "아직 고정되지 않은 첫 ICP 후보",
    problem: problem || "아직 검증되지 않은 고객 문제",
    actionText,
    action_text: actionText,
    artifact,
    evidenceType: evidenceMode.evidenceType,
    evidence_type: evidenceMode.evidenceType,
    allowedEvidenceTypes: evidenceMode.allowedTypes,
    allowed_evidence_types: evidenceMode.allowedTypes,
    deadlineAt,
    deadline_at: deadlineAt,
    completionSignal: buildMissionCompletionSignal(dayNumber, evidenceMode.evidenceType),
    completion_signal: buildMissionCompletionSignal(dayNumber, evidenceMode.evidenceType),
    failureMiniAction: buildFailureMiniAction(dayNumber),
    failure_mini_action: buildFailureMiniAction(dayNumber),
    sourceEvidenceRefs,
    source_evidence_refs: sourceEvidenceRefs,
    primaryCta: "증거 제출",
    primary_cta: "증거 제출",
    chatRole: "explain_or_adjust_mission",
    chat_role: "explain_or_adjust_mission",
    agentBridge: buildAgentBridgeContract(),
    agent_bridge: buildAgentBridgeContract(),
    valueContract: contract
      ? {
          todayValue: contract.todayValue,
          evidenceArtifact: contract.evidenceArtifact,
          passGate: contract.passGate,
          failGate: contract.failGate,
        }
      : null,
    value_contract: contract
      ? {
          today_value: contract.todayValue,
          evidence_artifact: contract.evidenceArtifact,
          pass_gate: contract.passGate,
          fail_gate: contract.failGate,
        }
      : null,
  };
}

export function composeExecutionOsSnapshot({
  workspaceRoot = "",
  day = 1,
  curriculumDay = null,
  day1GoalSelection = null,
  projectContext = null,
  proofLedger = null,
  progressState = {},
  dayRecords = [],
  verificationStates = null,
  diagnostics = null,
  preflight = null,
  releaseState = null,
  telemetryState = null,
  crashState = null,
  routeTimings = [],
  now = new Date(),
} = {}) {
  const currentDay = normalizeDay(day ?? curriculumDay?.day ?? curriculumDay?.dayId) ?? 1;
  const ledger = normalizeProofLedger(proofLedger ?? makeDefaultProofLedger(now), { now });
  const missionCard = buildDailyMissionCard({
    day: currentDay,
    curriculumDay,
    day1GoalSelection,
    projectContext,
    proofLedger: ledger,
    now,
  });
  const prerequisiteRequirements = buildProofPrerequisiteRequirements({
    currentDay,
    proofLedger: ledger,
  });
  const proofDayRecords = buildProofDayRecords(ledger);
  const progressionGate = evaluateCurriculumProgressionGate({
    currentDay,
    prerequisiteRequirements,
    progressState,
    dayRecords: [...proofDayRecords, ...asArray(dayRecords)],
    verificationStates,
    now,
  });
  const foundationClosure = evaluateFoundationClosure({
    proofLedger: ledger,
    currentDay,
    progressState,
    now,
  });
  const metrics = computeExecutionOsMetrics({
    proofLedger: ledger,
    routeTimings,
  });
  const readiness = evaluatePilotReadiness({
    diagnostics,
    preflight,
    releaseState,
    telemetryState,
    crashState,
    now,
  });

  return {
    schemaVersion: EXECUTION_OS_SCHEMA_VERSION,
    schema_version: EXECUTION_OS_SCHEMA_VERSION,
    schema: "agentic30.execution_os.snapshot.v1",
    generatedAt: toIso(now),
    generated_at: toIso(now),
    workspaceRoot,
    workspace_root: workspaceRoot,
    currentDay,
    current_day: currentDay,
    operatingPrinciple: "mission_card_above_chat_submit_judge_unlock",
    operating_principle: "mission_card_above_chat_submit_judge_unlock",
    proofLedger: ledger,
    proof_ledger: ledger,
    missionCard,
    mission_card: missionCard,
    submitJudgeUnlock: buildSubmitJudgeUnlockContract(currentDay),
    submit_judge_unlock: buildSubmitJudgeUnlockContract(currentDay),
    progressionGate,
    progression_gate: progressionGate,
    foundationClosure,
    foundation_closure: foundationClosure,
    firstValue: buildFirstValueContract(metrics, missionCard),
    first_value: buildFirstValueContract(metrics, missionCard),
    metrics,
    pilotReadiness: readiness,
    pilot_readiness: readiness,
  };
}

export function computeExecutionOsMetrics({
  proofLedger = {},
  routeTimings = [],
} = {}) {
  const ledger = normalizeProofLedger(proofLedger);
  const events = ledger.events;
  const setupEvent = events.find((event) => event.type === PROOF_EVENT_TYPES.setup);
  const missionEvent = events.find((event) => event.type === PROOF_EVENT_TYPES.mission);
  const evidenceEvents = events.filter((event) => isSubmittedProofEvent(event) && isEvidenceEvent(event));
  const day3Evidence = evidenceEvents.some((event) => Number(event.day) >= 3);
  const day7Decision = findDay7Decision(events);
  const moneyOrTimeAsk = events.some((event) =>
    isSubmittedProofEvent(event)
      && (
        event.type === PROOF_EVENT_TYPES.dmAsk
        || event.type === PROOF_EVENT_TYPES.paymentIntent
        || normalizeToken(event.metadata?.askKind ?? event.metadata?.ask_kind).includes("time")
        || normalizeToken(event.metadata?.askKind ?? event.metadata?.ask_kind).includes("money")
      ),
  );
  const referral = events.some((event) =>
    isSubmittedProofEvent(event) && event.type === PROOF_EVENT_TYPES.referral,
  );
  const timings = asArray(routeTimings)
    .map(normalizeRouteTiming)
    .filter(Boolean);
  const genericCount = timings.filter((timing) => timing.route === "generic" || timing.genericAnswer).length;

  return {
    schemaVersion: EXECUTION_OS_METRICS_SCHEMA_VERSION,
    schema_version: EXECUTION_OS_METRICS_SCHEMA_VERSION,
    schema: "agentic30.execution_os.metrics.v1",
    setupSuccess: Boolean(setupEvent && isSubmittedProofEvent(setupEvent)),
    setup_success: Boolean(setupEvent && isSubmittedProofEvent(setupEvent)),
    timeToFirstMissionMs: computeDeltaMs(setupEvent?.createdAt, missionEvent?.createdAt),
    time_to_first_mission_ms: computeDeltaMs(setupEvent?.createdAt, missionEvent?.createdAt),
    firstEvidenceSubmitted: evidenceEvents.length > 0,
    first_evidence_submitted: evidenceEvents.length > 0,
    firstEvidenceSubmittedAt: evidenceEvents[0]?.createdAt ?? null,
    first_evidence_submitted_at: evidenceEvents[0]?.createdAt ?? null,
    day3Retained: day3Evidence,
    day3_retained: day3Evidence,
    day7DecisionCompleted: Boolean(day7Decision && isCompletedProofEvent(day7Decision)),
    day7_decision_completed: Boolean(day7Decision && isCompletedProofEvent(day7Decision)),
    moneyOrTimeAskSent: moneyOrTimeAsk,
    money_or_time_ask_sent: moneyOrTimeAsk,
    referralSignal: referral,
    referral_signal: referral,
    genericAnswerRate: timings.length ? roundRatio(genericCount / timings.length) : 0,
    generic_answer_rate: timings.length ? roundRatio(genericCount / timings.length) : 0,
    routeLatencyP50Ms: percentile(timings.map((timing) => timing.elapsedMs), 0.5),
    route_latency_p50_ms: percentile(timings.map((timing) => timing.elapsedMs), 0.5),
    routeLatencyP95Ms: percentile(timings.map((timing) => timing.elapsedMs), 0.95),
    route_latency_p95_ms: percentile(timings.map((timing) => timing.elapsedMs), 0.95),
    proofEventCount: events.length,
    proof_event_count: events.length,
  };
}

export function evaluatePilotReadiness({
  diagnostics = null,
  preflight = null,
  releaseState = null,
  telemetryState = null,
  crashState = null,
  now = new Date(),
} = {}) {
  const blockers = [];
  const warnings = [];
  const release = objectOrEmpty(releaseState);
  const telemetry = objectOrEmpty(telemetryState);
  const crash = objectOrEmpty(crashState);
  const preflightReport = preflight ?? diagnostics?.preflight ?? null;

  addReadinessCheck(blockers, warnings, {
    id: "preflight-ok",
    ok: !preflightReport || preflightReport.status !== "failed",
    severity: "blocker",
    message: "Sidecar preflight must not have failed checks.",
  });
  addReadinessCheck(blockers, warnings, {
    id: "diagnostics-redacted",
    ok: Boolean(diagnostics) && diagnostics.redactionSafe !== false,
    severity: "blocker",
    message: "Diagnostics snapshot must exist and be redaction-safe.",
  });
  addReadinessCheck(blockers, warnings, {
    id: "signed-installer",
    ok: release.signed === true || release.developerIdSigned === true || release.developer_id_signed === true,
    severity: "blocker",
    message: "Public pilot requires Developer ID signing.",
  });
  addReadinessCheck(blockers, warnings, {
    id: "notarized-installer",
    ok: release.notarized === true,
    severity: "blocker",
    message: "Public pilot requires notarization.",
  });
  addReadinessCheck(blockers, warnings, {
    id: "updater-configured",
    ok: release.updaterConfigured === true
      || release.updater_configured === true
      || release.sparkleConfigured === true
      || release.sparkle_configured === true,
    severity: "blocker",
    message: "Public pilot requires an updater path.",
  });
  addReadinessCheck(blockers, warnings, {
    id: "native-crash-reporting",
    ok: crash.nativeCrashReportingAvailable === true
      || crash.native_crash_reporting_available === true
      || crash.available === true,
    severity: "blocker",
    message: "Public pilot requires native crash reporting or an equivalent crash intake.",
  });
  addReadinessCheck(blockers, warnings, {
    id: "telemetry-opt-out",
    ok: telemetry.optOutAvailable === true
      || telemetry.opt_out_available === true
      || telemetry.configured === true,
    severity: "warning",
    message: "Telemetry should be configured with an opt-out path before broader pilots.",
  });
  addReadinessCheck(blockers, warnings, {
    id: "provider-auth-setup",
    ok: providerAuthIsActionable(preflightReport),
    severity: "warning",
    message: "Provider auth setup should be visible and recoverable, even though first value has a local fallback.",
  });

  const status = blockers.length ? "blocked" : warnings.length ? "warning" : "ready";
  return {
    schemaVersion: PILOT_READINESS_SCHEMA_VERSION,
    schema_version: PILOT_READINESS_SCHEMA_VERSION,
    schema: "agentic30.execution_os.pilot_readiness.v1",
    generatedAt: toIso(now),
    generated_at: toIso(now),
    status,
    publicPilotReady: status === "ready",
    public_pilot_ready: status === "ready",
    privatePilotReady: !blockers.some((blocker) => ["preflight-ok", "diagnostics-redacted"].includes(blocker.id)),
    private_pilot_ready: !blockers.some((blocker) => ["preflight-ok", "diagnostics-redacted"].includes(blocker.id)),
    blockers,
    warnings,
  };
}

export function captureExecutionOsTelemetryEvents(
  telemetry,
  snapshot = {},
  { previousMetrics = null } = {},
) {
  if (!telemetry || typeof telemetry.captureEvent !== "function") return [];
  const metrics = snapshot.metrics ?? snapshot.executionOsMetrics ?? {};
  const previous = previousMetrics ?? {};
  const emitted = [];
  const checks = [
    ["firstEvidenceSubmitted", "mac_sidecar_execution_os_first_evidence_submitted"],
    ["day7DecisionCompleted", "mac_sidecar_execution_os_day7_decision_completed"],
    ["moneyOrTimeAskSent", "mac_sidecar_execution_os_money_time_ask_sent"],
    ["referralSignal", "mac_sidecar_execution_os_referral_signal"],
  ];
  if (snapshot.missionCard && previous.firstMissionReady !== true) {
    capture(telemetry, emitted, "mac_sidecar_execution_os_first_mission_ready", snapshot);
  }
  for (const [key, eventName] of checks) {
    if (metrics[key] === true && previous[key] !== true) {
      capture(telemetry, emitted, eventName, snapshot);
    }
  }
  capture(telemetry, emitted, "mac_sidecar_execution_os_readiness_checked", snapshot);
  return emitted;
}

export function buildProofPrerequisiteRequirements({ currentDay = 1, proofLedger = {} } = {}) {
  const day = normalizeDay(currentDay) ?? 1;
  if (day <= 1) return { currentDay: day, requirements: [] };
  const ledger = normalizeProofLedger(proofLedger);
  const requirements = [];
  for (let sourceDay = 1; sourceDay < Math.min(day, 8); sourceDay += 1) {
    const proof = findBestDayProof(ledger.events, sourceDay);
    requirements.push({
      requirementId: `proof-ledger-day-${sourceDay}-accepted`,
      requirement_id: `proof-ledger-day-${sourceDay}-accepted`,
      requirementMode: "blocking_prerequisite",
      requirement_mode: "blocking_prerequisite",
      requiredBefore: "next_day_unlock",
      required_before: "next_day_unlock",
      sourceDay,
      source_day: sourceDay,
      sourceActionId: `day-${sourceDay}-proof`,
      source_action_id: `day-${sourceDay}-proof`,
      actionDescription: `Day ${sourceDay} proof must be submitted and judged accepted.`,
      action_description: `Day ${sourceDay} proof must be submitted and judged accepted.`,
      completionSignal: "action_evidence status accepted or verified",
      completion_signal: "action_evidence status accepted or verified",
      status: proof ? proof.status : "unmet",
      verified: Boolean(proof && isCompletedProofEvent(proof)),
      blocking: true,
    });
  }
  if (day >= 8) {
    const decision = findDay7Decision(ledger.events);
    requirements.push({
      requirementId: "foundation-day-7-decision",
      requirement_id: "foundation-day-7-decision",
      requirementMode: "blocking_prerequisite",
      requirement_mode: "blocking_prerequisite",
      requiredBefore: "progression_gate",
      required_before: "progression_gate",
      sourceDay: 7,
      source_day: 7,
      sourceActionId: "day-7-decision",
      source_action_id: "day-7-decision",
      actionDescription: "Day 7 continue / pivot / stop decision must be closed.",
      action_description: "Day 7 continue / pivot / stop decision must be closed.",
      completionSignal: "day_decision status accepted or verified",
      completion_signal: "day_decision status accepted or verified",
      status: decision ? decision.status : "unmet",
      verified: Boolean(decision && isCompletedProofEvent(decision)),
      blocking: true,
    });
  }
  return { currentDay: day, requirements };
}

export function evaluateFoundationClosure({
  proofLedger = {},
  currentDay = 1,
  now = new Date(),
} = {}) {
  const ledger = normalizeProofLedger(proofLedger, { now });
  const events = ledger.events.filter((event) => event.day === 0 || (event.day >= 1 && event.day <= 7));
  const coveredDays = [...new Set(events.filter(isSubmittedProofEvent).map((event) => event.day))]
    .filter((day) => day !== null)
    .sort((a, b) => a - b);
  const day7Decision = findDay7Decision(events);
  const supporting = findStrongPolarityEvent(events, "supporting");
  const counter = findStrongPolarityEvent(events, "counter");
  const goNoGoReady = Boolean(
    day7Decision
      && isCompletedProofEvent(day7Decision)
      && supporting
      && counter,
  );
  const status = goNoGoReady
    ? "closed"
    : day7Decision
      ? "decision_needs_supporting_and_counter_evidence"
      : Number(currentDay) >= 7
        ? "day7_decision_pending"
        : "evidence_collection_in_progress";
  return {
    schema: "agentic30.execution_os.foundation_closure.v1",
    dayRange: { start: 0, end: 7 },
    day_range: { start: 0, end: 7 },
    requiredDays: [0, 1, 2, 3, 4, 5, 6, 7],
    required_days: [0, 1, 2, 3, 4, 5, 6, 7],
    coveredDays,
    covered_days: coveredDays,
    day7DecisionRequired: true,
    day7_decision_required: true,
    day7DecisionCompleted: Boolean(day7Decision && isCompletedProofEvent(day7Decision)),
    day7_decision_completed: Boolean(day7Decision && isCompletedProofEvent(day7Decision)),
    decision: day7Decision?.decision || null,
    strongestSupportingEvidenceId: supporting?.id || null,
    strongest_supporting_evidence_id: supporting?.id || null,
    strongestCounterEvidenceId: counter?.id || null,
    strongest_counter_evidence_id: counter?.id || null,
    goNoGoReady,
    go_no_go_ready: goNoGoReady,
    status,
    nextRequiredAction: foundationClosureNextAction(status),
    next_required_action: foundationClosureNextAction(status),
  };
}

function buildProofDayRecords(ledger = {}) {
  return normalizeProofLedger(ledger).events
    .filter((event) => event.day !== null && event.day > 0)
    .map((event) => ({
      day: event.day,
      actions: [
        {
          actionId: `day-${event.day}-proof`,
          action_id: `day-${event.day}-proof`,
          sourceActionId: `day-${event.day}-proof`,
          source_action_id: `day-${event.day}-proof`,
          status: event.status,
          verified: isCompletedProofEvent(event),
          evidenceSubmission: {
            status: event.status,
            validationStatus: event.status,
            validation_status: event.status,
            evidenceType: event.evidenceType,
            evidence_type: event.evidenceType,
          },
        },
      ],
    }));
}

function buildSubmitJudgeUnlockContract(day) {
  return {
    schema: "agentic30.execution_os.submit_judge_unlock.v1",
    currentDay: day,
    current_day: day,
    submit: {
      module: "action-day-evidence-submission.mjs",
      eventTypes: [PROOF_EVENT_TYPES.actionEvidence, PROOF_EVENT_TYPES.interview, PROOF_EVENT_TYPES.dmAsk],
      event_types: [PROOF_EVENT_TYPES.actionEvidence, PROOF_EVENT_TYPES.interview, PROOF_EVENT_TYPES.dmAsk],
    },
    judge: {
      module: "action-evidence-judge.mjs",
      acceptedStatuses: [...COMPLETED_PROOF_STATUSES],
      accepted_statuses: [...COMPLETED_PROOF_STATUSES],
    },
    unlock: {
      module: "curriculum-progression-gate.mjs",
      nextDayRequires: "accepted_or_verified_proof_event_for_prior_day",
      next_day_requires: "accepted_or_verified_proof_event_for_prior_day",
      day7RequiresDecision: true,
      day7_requires_decision: true,
    },
  };
}

function buildFirstValueContract(metrics, missionCard) {
  return {
    targetMs: 10 * 60 * 1000,
    target_ms: 10 * 60 * 1000,
    providerRequired: false,
    provider_required: false,
    localFallbackAvailable: true,
    local_fallback_available: true,
    firstMissionReady: Boolean(missionCard),
    first_mission_ready: Boolean(missionCard),
    timeToFirstMissionMs: metrics.timeToFirstMissionMs,
    time_to_first_mission_ms: metrics.timeToFirstMissionMs,
    meetsTarget: metrics.timeToFirstMissionMs === null || metrics.timeToFirstMissionMs <= 10 * 60 * 1000,
    meets_target: metrics.timeToFirstMissionMs === null || metrics.timeToFirstMissionMs <= 10 * 60 * 1000,
  };
}

function buildAgentBridgeContract() {
  return {
    role: "execution_tool",
    primarySurface: false,
    primary_surface: false,
    productWedge: false,
    product_wedge: false,
    providers: ["claude", "codex", "cursor"],
    allowedWhen: ["draft_message", "inspect_workspace", "summarize_evidence", "execute_scoped_change"],
    allowed_when: ["draft_message", "inspect_workspace", "summarize_evidence", "execute_scoped_change"],
  };
}

function addReadinessCheck(blockers, warnings, check) {
  if (check.ok) return;
  const entry = {
    id: check.id,
    severity: check.severity,
    message: check.message,
  };
  if (check.severity === "blocker") blockers.push(entry);
  else warnings.push(entry);
}

function providerAuthIsActionable(preflight) {
  if (!preflight) return false;
  const provider = asArray(preflight.checks).find((check) => check.id === "provider-auth");
  if (!provider) return false;
  return provider.status === "ok" || Boolean(provider.recovery);
}

function capture(telemetry, emitted, eventName, snapshot) {
  telemetry.captureEvent(eventName, {
    current_day: snapshot.currentDay ?? snapshot.current_day ?? null,
    pilot_readiness_status: snapshot.pilotReadiness?.status ?? snapshot.pilot_readiness?.status ?? "",
    foundation_closure_status: snapshot.foundationClosure?.status ?? snapshot.foundation_closure?.status ?? "",
    proof_event_count: snapshot.metrics?.proofEventCount ?? snapshot.metrics?.proof_event_count ?? 0,
  });
  emitted.push(eventName);
}

function missionEvidenceActionType(day, actionText) {
  const text = normalizeToken(actionText);
  if (day === 6 || text.includes("price") || text.includes("money") || text.includes("시간") || text.includes("돈")) {
    return "dm_log";
  }
  if (text.includes("landing") || text.includes("url") || text.includes("링크")) return "landing";
  if (text.includes("recording") || text.includes("transcript") || text.includes("녹음")) return "interview_recording";
  return "dm_log";
}

function inferExpectedEvidenceTypes(day, actionText) {
  const text = String(actionText || "").toLowerCase();
  if (day === 6 || /dm|url|link|landing|threads|post|링크|발송|보낸/.test(text)) return ["link"];
  if (/file|recording|transcript|screenshot|녹음|스크린샷|파일/.test(text)) return ["file"];
  return null;
}

function buildMissionCompletionSignal(day, evidenceType) {
  if (day === 7) return "continue / pivot / stop 결정과 가장 강한 증거, 반증이 기록되어야 합니다.";
  return evidenceType === "file"
    ? "로컬 파일 증거를 제출하고 판정이 accepted 또는 verified가 되어야 합니다."
    : "공유 가능한 링크나 원문 증거를 제출하고 판정이 accepted 또는 verified가 되어야 합니다.";
}

function buildFailureMiniAction(day) {
  if (day === 7) return "결정을 미루는 이유와 다음 24시간 안에 필요한 증거 1개를 기록한다.";
  if (day === 6) return "가격이나 시간 약속을 묻지 못했다면 대상 이름과 못 물은 이유 1줄을 기록한다.";
  return "대상 이름, 연락 채널, 막힌 이유 1줄을 proof ledger에 남긴다.";
}

function findBestDayProof(events, day) {
  const dayEvents = events.filter((event) =>
    event.day === day
      && isEvidenceEvent(event)
      && isSubmittedProofEvent(event),
  );
  return dayEvents.find(isCompletedProofEvent) ?? dayEvents[0] ?? null;
}

function findDay7Decision(events) {
  return events.find((event) =>
    event.type === PROOF_EVENT_TYPES.dayDecision
      && Number(event.day) >= 7
      && DECISIONS.has(event.decision),
  ) ?? null;
}

function findStrongPolarityEvent(events, polarity) {
  return events.find((event) =>
    event.polarity === polarity
      && isCompletedProofEvent(event)
      && (event.strength === "strong" || event.strength === "medium"),
  ) ?? null;
}

function foundationClosureNextAction(status) {
  switch (status) {
    case "closed":
      return "다음 7일 proof target을 시작한다.";
    case "decision_needs_supporting_and_counter_evidence":
      return "Day 7 결정에 가장 강한 증거와 반증을 모두 연결한다.";
    case "day7_decision_pending":
      return "continue / pivot / stop 중 하나를 선택하고 증거를 연결한다.";
    default:
      return "오늘 미션 증거를 제출하고 accepted 판정을 받는다.";
  }
}

function isEvidenceEvent(event) {
  return ![PROOF_EVENT_TYPES.setup, PROOF_EVENT_TYPES.mission].includes(event.type);
}

function isSubmittedProofEvent(event) {
  return SUBMITTED_PROOF_STATUSES.has(normalizeToken(event?.status));
}

function isCompletedProofEvent(event) {
  return COMPLETED_PROOF_STATUSES.has(normalizeToken(event?.status));
}

function inferProofStrength({ type, status }) {
  if (type === PROOF_EVENT_TYPES.paymentIntent || status === "verified") return "strong";
  if (status === "accepted" || type === PROOF_EVENT_TYPES.dmAsk) return "medium";
  return "weak";
}

function normalizeRouteTiming(value = {}) {
  const raw = objectOrEmpty(value);
  const elapsedMs = Number(raw.elapsedMs ?? raw.elapsed_ms ?? raw.durationMs ?? raw.duration_ms);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  return {
    route: normalizeToken(raw.route ?? raw.path ?? raw.kind),
    elapsedMs: Math.round(elapsedMs),
    genericAnswer: raw.genericAnswer === true || raw.generic_answer === true,
  };
}

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function computeDeltaMs(start, end) {
  const a = Date.parse(String(start || ""));
  const b = Date.parse(String(end || ""));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round(b - a));
}

function roundRatio(value) {
  return Math.round(value * 1000) / 1000;
}

function normalizeEvidenceType(value) {
  const token = normalizeToken(value);
  if (token === "file" || token === "file_upload") return "file";
  if (token === "link" || token === "url") return "link";
  return "";
}

function normalizeDecision(value) {
  const token = normalizeToken(value);
  return DECISIONS.has(token) ? token : "";
}

function normalizePolarity(value) {
  const token = normalizeToken(value);
  if (["counter", "counter_evidence", "negative", "risk"].includes(token)) return "counter";
  if (["support", "supporting", "positive", "evidence"].includes(token)) return "supporting";
  return "";
}

function normalizeAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeDay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const day = Math.trunc(number);
  return day >= 0 && day <= 400 ? day : null;
}

function normalizeIsoDate(value, fallback) {
  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return toIso(fallback);
}

function dateFrom(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toIso(value) {
  return dateFrom(value).toISOString();
}

function defaultProofEventTitle(type, index) {
  return `${type || "proof"} #${index + 1}`;
}

function cleanProofUrl(value) {
  const text = cleanString(value, 500);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|password|authorization/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

function cleanProofPath(value) {
  return redactInlineSecrets(cleanString(value, 500));
}

function sanitizeProofMetadata(value) {
  const raw = objectOrEmpty(value);
  const output = {};
  for (const [key, nested] of Object.entries(raw)) {
    const cleanKey = cleanString(key, 80);
    if (!cleanKey) continue;
    if (/token|secret|key|authorization|password/i.test(cleanKey)) {
      output[cleanKey] = nested ? "[redacted]" : nested;
      continue;
    }
    if (Array.isArray(nested)) {
      output[cleanKey] = nested.slice(0, 20).map((item) =>
        typeof item === "object" ? sanitizeProofMetadata(item) : redactInlineSecrets(cleanString(item, 300)),
      );
      continue;
    }
    if (nested && typeof nested === "object") {
      output[cleanKey] = sanitizeProofMetadata(nested);
      continue;
    }
    output[cleanKey] = typeof nested === "string"
      ? redactInlineSecrets(cleanString(nested, 500))
      : nested;
  }
  return output;
}

function redactInlineSecrets(value) {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .replace(/ghp_[A-Za-z0-9]{20,}/g, "[redacted]")
    .replace(/xox[baprs]-[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, "[redacted]");
}

function normalizeStringArray(value = [], maxItems = 12, maxLength = 260) {
  const input = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const output = [];
  for (const item of input) {
    const text = cleanString(item, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeToken(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9가-힣_]/g, "")
    .slice(0, 120);
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

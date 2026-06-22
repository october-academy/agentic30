import { loadActiveUsersStore, latestFirstValueSignal } from "./active-users-snapshot.mjs";
import { loadProofLedger } from "./execution-os.mjs";
import { buildProgramDailyCardEvent } from "./mission-card.mjs";
import {
  OFFICE_HOURS_RESOLUTION_REASONS,
  classifyStaleCommitments,
  loadOfficeHoursMemory,
} from "./office-hours-memory.mjs";
import { resolveCloudflareMcpSettings } from "./cloudflare-mcp-config.mjs";
import { resolvePostHogMcpSettings } from "./posthog-mcp-config.mjs";
import { evaluateProgramGates } from "./program-gate-engine.mjs";
import { buildRevenueOrActivationGateCard as buildRuntimeGateCard } from "./program-gate-card.mjs";
import { buildProgramScoreboardSnapshot } from "./program-scoreboard.mjs";
import {
  buildProgramV2Generation,
  buildProgramV2SourceStateVersion,
  hashProgramV2CardText,
  withProgramV2CardIdentity,
} from "./program-v2-card-identity.mjs";

export async function buildProgramV2DailyCardEvents({
  workspaceRoot,
  day,
  gateEvaluation = null,
  appSupportPath = "",
  env = process.env,
  now = new Date(),
} = {}) {
  const programDay = normalizeDay(day);
  if (!workspaceRoot || !programDay) return [];
  const context = await buildProgramV2DailyCardContext({ workspaceRoot, programDay, gateEvaluation, appSupportPath, env, now });
  return context.cards.map((missionCard) => buildProgramDailyCardEvent({ workspaceRoot, missionCard }));
}

export async function emitProgramV2DailyCards(options = {}) {
  const events = await buildProgramV2DailyCardEvents(options);
  for (const event of events) options.broadcast?.(event);
  return events;
}

export async function buildProgramV2DailyCardContext({
  workspaceRoot,
  programDay,
  gateEvaluation = null,
  appSupportPath = "",
  env = process.env,
  now = new Date(),
} = {}) {
  const memory = await loadOfficeHoursMemory({ workspaceRoot, now });
  const proofLedger = await loadProofLedger({ workspaceRoot });
  const activeUsersStore = await loadActiveUsersStore({ workspaceRoot });
  const firstValue = await latestFirstValueSignal({ workspaceRoot });
  const sources = {
    posthogAvailable: resolvePostHogMcpSettings({ env, appSupportPath })?.tokenValid === true,
    cloudflareAvailable: resolveCloudflareMcpSettings({ env, appSupportPath })?.tokenValid === true,
  };
  const evaluation = gateEvaluation ?? evaluateProgramGates({ proofLedger, currentDay: programDay, firstValue, sources, now });
  const sourceStateVersion = buildProgramV2SourceStateVersion({ memory, proofLedger, activeUsersStore, programDay, evaluation });
  const staleCandidate = classifyStaleCommitments(memory, { currentDay: programDay })[0] ?? null;
  const scoreboardSnapshot = buildProgramScoreboardSnapshot({
    programDay,
    activeUsersStore,
    proofLedger,
    sourceStates: {
      activeUsers100: activeUsersStore.snapshots.length ? "ready" : "missing",
      firstRevenue: proofLedger.events.length ? "ready" : "missing",
    },
  });
  const context = {
    workspaceRoot,
    programDay,
    memory,
    proofLedger,
    activeUsersStore,
    firstValue,
    sources,
    evaluation,
    sourceStateVersion,
    staleCandidate,
    scoreboardSnapshot,
  };
  const cards = [];
  if (staleCandidate) cards.push(buildStateTransitionCard(context));
  const workpackCard = buildWorkpackCard(context);
  if (workpackCard) cards.push(workpackCard);
  cards.push(buildScoreboardCard(context), buildGateCard(context));
  context.cards = cards;
  context.cardsById = new Map(cards.map((card) => [card.id, card]));
  return context;
}

function buildStateTransitionCard(context) {
  const candidate = context.staleCandidate;
  return withProgramV2CardIdentity({
    type: "office_hours_state_transition",
    schemaVersion: 1,
    programDay: context.programDay,
    generation: buildProgramV2Generation("office-hours-state-transition", "Office Hours stale commitment", context),
    sourceState: "stale",
    requiresUserAction: true,
    proofLedgerMapping: { self_report: "officeHoursResolution.negativeEvidenceOnly" },
    commitmentId: candidate.commitmentId,
    sourceCommitmentId: candidate.commitmentId,
    candidateName: candidate.candidateName,
    actionText: candidate.actionText,
    repeatCountWithoutEvidence: candidate.repeatCountWithoutEvidence,
    choices: [
      { id: "attach_evidence", label: "Attach evidence" },
      { id: "resolve_without_evidence", label: "Resolve without evidence" },
      { id: "replace_candidate", label: "Replace candidate" },
      { id: "keep_open_today", label: "Keep open today" },
    ],
    resolutionReasons: OFFICE_HOURS_RESOLUTION_REASONS,
  }, context);
}

function buildWorkpackCard(context) {
  const commitment = selectWorkpackCommitment(context);
  if (!commitment) return null;
  const lens = selectWorkpackLens(context);
  const targetExternalAction = commitment.actionText;
  const expectedProof = commitment.expectedEvidenceKind;
  return withProgramV2CardIdentity({
    type: "office_hours_agent_workpack",
    schemaVersion: 1,
    programDay: context.programDay,
    generation: buildProgramV2Generation("office-hours-workpack", "Office Hours agent workpack", context),
    sourceState: "ready",
    requiresUserAction: true,
    proofLedgerMapping: { customer_screenshot: "customerEvidence.acceptedProof" },
    sourceCommitmentId: commitment.id,
    selectedLens: lens.lens,
    lensReason: lens.reason,
    workpack: {
      id: `workpack-${hashProgramV2CardText(`${context.programDay}:${commitment.actionText}`)}`,
      workType: lens.workType,
      targetExternalAction,
      expectedProof,
      owner: "founder",
      deadline: workpackDeadline(commitment),
      notProof: ["self-report", "interest without customer action"],
    },
  }, context);
}

// Risk-Based Lens selection (spec §5.5). Reads the current program risk signals
// from `context` and picks exactly one lens + a workType drawn from the
// program-daily-card WORK_TYPES allowlist. Falls back to the safe paid-ask
// default when no risk signal dominates, so an absent signal never produces an
// unknown lens or workType.
function selectWorkpackLens(context) {
  const signals = readRiskSignals(context);

  // 고객 증거 부채가 active면 Service planning 또는 Risk/tradeoff를 우선한다.
  // 반복 자기보고가 많으면 Risk/tradeoff를 고른다.
  if (signals.repeatedSelfReport) {
    return { lens: "risk_tradeoff", workType: "follow-up plan", reason: "반복 자기보고가 누적되어 빌드 도피/허위 진행 리스크를 점검" };
  }
  if (signals.customerEvidenceDebt) {
    return { lens: "service_planning", workType: "offer/paid ask", reason: "고객 증거 부채가 active — offer/wedge가 맞는지 먼저 정리" };
  }
  // 증거를 받을 대상은 있는데 제품 사용 자체가 막히면 Technical implementation.
  if (signals.productBlocksValidation) {
    return { lens: "technical_implementation", workType: "first_value instrumentation snippet", reason: "증거 대상은 있으나 계측/배포가 막혀 검증 action 불가" };
  }
  // 사용자가 제품을 보거나 activation을 완료했지만 friction이 높으면 UI/UX.
  if (signals.activationFriction) {
    return { lens: "ui_ux", workType: "activation friction fix", reason: "첫 가치를 보지만 activation friction이 높음" };
  }
  // firstRevenue scoreboard가 정체되면 offer/paid ask 또는 follow-up plan workpack.
  if (signals.revenueStalled) {
    return { lens: "service_planning", workType: "offer/paid ask", reason: "firstRevenue 정체 — 유료 ask로 전환 증거 확보" };
  }
  // activeUsers100 scoreboard가 정체되면 Acquisition/channel 또는 activation friction fix.
  if (signals.activeUsersStalled) {
    return { lens: "acquisition_channel", workType: "channel experiment", reason: "activeUsers100 정체 — named contact/active user를 만들 채널 실험" };
  }
  // 선택 근거가 없으면 안전한 기본값 유지.
  return { lens: "service_planning", workType: "offer/paid ask", reason: "지배적 risk 신호 없음 — 기본 유료 ask 증거 lens 유지" };
}

function readRiskSignals(context) {
  const active = context.scoreboardSnapshot?.scoreboards?.activeUsers100 ?? {};
  const revenue = context.scoreboardSnapshot?.scoreboards?.firstRevenue ?? {};
  const commitments = Array.isArray(context.memory?.commitments) ? context.memory.commitments : [];
  const repeatedSelfReportCount = commitments.filter(
    (commitment) => commitment?.status === "resolved_without_evidence"
      || Number(commitment?.repeatCountWithoutEvidence) >= 2,
  ).length;
  const customerEvidenceDebt = Boolean(context.staleCandidate)
    || commitments.some((commitment) => commitment?.status === "open" && !commitment.evidence);
  const hasFirstValue = Boolean(context.firstValue);
  const activeAccepted = Number(active.acceptedCount ?? active.accepted_count ?? 0);
  const activeReady = (active.sourceState ?? active.source_state) === "ready";
  const revenueAccepted = Number(revenue.acceptedCount ?? revenue.accepted_count ?? 0);
  return {
    repeatedSelfReport: repeatedSelfReportCount >= 2,
    customerEvidenceDebt,
    // first_value 신호는 있는데 active scoreboard source가 아직 없음 = 계측/제품이 검증을 막음.
    productBlocksValidation: hasFirstValue && !activeReady,
    // activation은 됐는데(source ready) 활성 사용자가 아직 거의 없음 = friction.
    activationFriction: hasFirstValue && activeReady && activeAccepted > 0,
    revenueStalled: revenueAccepted <= 0,
    activeUsersStalled: activeAccepted <= 0,
  };
}

function buildScoreboardCard(context) {
  const activeState = context.scoreboardSnapshot.scoreboards.activeUsers100.sourceState;
  const revenueState = context.scoreboardSnapshot.scoreboards.firstRevenue.sourceState;
  return withProgramV2CardIdentity({
    ...context.scoreboardSnapshot,
    generation: buildProgramV2Generation("program-scoreboard", "Program scoreboard", context),
    sourceState: mergeSourceStates([activeState, revenueState]),
    requiresUserAction: false,
    proofLedgerMapping: {
      first_value: "activeUsers100.acceptedProof",
      paymentRecord: "firstRevenue.acceptedProof",
    },
  }, context);
}

function buildGateCard(context) {
  const gateId = context.programDay >= 30
    ? "G7"
    : context.programDay >= 28
      ? "G6"
      : context.programDay >= 21
        ? "G5"
        : "G4";
  const gateCard = buildRuntimeGateCard({
    gateId,
    evaluation: context.evaluation,
    scoreboardSnapshot: context.scoreboardSnapshot,
    sourceStates: {
      firstValue: context.activeUsersStore.snapshots.length ? "ready" : "missing",
      activeUsers100: context.activeUsersStore.snapshots.length ? "ready" : "missing",
      firstRevenue: context.proofLedger.events.length ? "ready" : "missing",
    },
  });
  return withProgramV2CardIdentity({
    ...gateCard,
  }, context);
}

function selectWorkpackCommitment(context) {
  if (context.staleCandidate?.commitment) return normalizeWorkpackCommitment(context.staleCandidate.commitment);
  const open = (Array.isArray(context.memory?.commitments) ? context.memory.commitments : [])
    .filter((commitment) => commitment?.status === "open" && !commitment.evidence)
    .sort((a, b) => commitmentCreatedMs(b) - commitmentCreatedMs(a));
  return normalizeWorkpackCommitment(open[0] ?? null);
}

function normalizeWorkpackCommitment(commitment) {
  if (!commitment || typeof commitment !== "object" || Array.isArray(commitment)) return null;
  const id = cleanString(commitment.id, 180);
  if (!id) return null;
  const actionText = cleanString(commitment.actionText ?? commitment.action_text ?? commitment.message ?? commitment.text, 500);
  const expectedEvidenceKind = cleanString(commitment.expectedEvidenceKind ?? commitment.expected_evidence_kind, 120);
  const dueDay = normalizeDay(commitment.dueDay ?? commitment.due_day);
  if (!actionText || !expectedEvidenceKind || !dueDay) return null;
  return {
    id,
    actionText,
    expectedEvidenceKind,
    dueDay,
    createdAt: cleanString(commitment.createdAt ?? commitment.created_at, 120),
  };
}

function workpackDeadline(commitment) {
  return `program-day-${commitment.dueDay}:23:59-local`;
}

function commitmentCreatedMs(commitment = {}) {
  const timestamp = Date.parse(String(commitment.createdAt ?? commitment.created_at ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeSourceStates(states) {
  for (const state of ["rejected", "missing", "stale", "manual_proof_required"]) {
    if (states.includes(state)) return state;
  }
  return "ready";
}

function normalizeDay(value) {
  const day = Number.parseInt(value, 10);
  return Number.isInteger(day) && day >= 1 ? day : null;
}

function cleanString(value = "", maxLength = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

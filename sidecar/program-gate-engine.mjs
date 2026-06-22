/**
 * Program Gate Engine (spec §10, §13.4, §14.3, §15.3).
 *
 * Evaluates milestone gates against the proof ledger and persists results to
 * `<ws>/.agentic30/gate-ledger.json` (schema v1). Evaluation is pure and
 * idempotent (§14.3) — the ledger can always be recomputed from the proof
 * ledger, so editing gate-ledger.json by hand changes nothing durable (§21).
 *
 * P0-3 scope: G1 / G2 / G4 evaluators. G3/G5/G6/G7 land with the
 * substitution table (P1-4). The existing Day 2–7 proof prerequisite chain
 * (`execution-os.mjs` + `curriculum-progression-gate.mjs`) stays authoritative
 * for per-day proofs; this engine layers milestone semantics on top
 * (delegation, §10.1 — non-destructive extension).
 *
 * Fail-closed invariants:
 * - milestone gates pass only on strong completed evidence (§9.3, D3).
 * - waive does not exist for milestone gates (§14.3).
 * - provisional (§21) only overlays `source_unavailable` blocks for at most
 *   3 days, only when every evidence condition is already met; it permits
 *   day progression but never counts as a gate pass.
 * - intervention tokens (§13.4) are issued at most once per gate, expire at
 *   dueDay without strong evidence, and expired tokens cannot be reissued.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import { resolveAgentic30Dir } from "./news-market-radar.mjs";
import {
  PROOF_EVENT_TYPES,
  evaluateFoundationClosure,
  loadProofLedger,
  normalizeProofLedger,
} from "./execution-os.mjs";
import { DAY1_STEPS, STANDARD_STEPS } from "./day-progress-state.mjs";

export const GATE_LEDGER_SCHEMA_VERSION = 1;
export const GATE_LEDGER_SCHEMA = "agentic30.gate_ledger.v1";

export const GATE_IDS = Object.freeze({
  G1: "G1",
  G2: "G2",
  G3: "G3",
  G4: "G4",
  G5: "G5",
  G6: "G6",
  G7: "G7",
});

export const GATE_STATES = Object.freeze({
  locked: "locked",
  open: "open",
  passed: "passed",
  blocked: "blocked",
  // §10.1 enum completeness only — milestone gates never waive (§14.3, D3).
  waived: "waived",
});

export const GATE_RESOLUTION_PATHS = Object.freeze({
  evidence: "evidence",
  confessionToken: "confession_token",
});

export const PROVISIONAL_MAX_DAYS = 3;
const EVALUATION_HISTORY_LIMIT = 30;
const ADAPTIVE_EVENT_LIMIT = 200;
const SUBSTITUTION_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const COMPLETED_STATUSES = new Set(["accepted", "verified", "complete", "completed"]);

/**
 * Milestone gate definitions (§10.2). `openDay` is when the gate becomes the
 * day's explicit objective; `enforceDay` is the first day whose entry the
 * gate hard-blocks (null = warning-style gate, never hard-blocks day entry).
 */
export const GATE_DEFINITIONS = Object.freeze({
  [GATE_IDS.G1]: Object.freeze({
    gateId: GATE_IDS.G1,
    title: "첫 고객 접촉",
    openDay: 1,
    enforceDay: 4,
    blockedStep: "goal",
  }),
  [GATE_IDS.G2]: Object.freeze({
    gateId: GATE_IDS.G2,
    title: "Foundation Go/No-Go",
    openDay: 7,
    enforceDay: 8,
    blockedStep: null,
  }),
  [GATE_IDS.G3]: Object.freeze({
    gateId: GATE_IDS.G3,
    title: "첫 ask",
    openDay: 6,
    enforceDay: null,
    blockedStep: null,
  }),
  [GATE_IDS.G4]: Object.freeze({
    gateId: GATE_IDS.G4,
    title: "유료 ask + 계측",
    openDay: 14,
    enforceDay: 15,
    blockedStep: null,
  }),
  [GATE_IDS.G5]: Object.freeze({
    gateId: GATE_IDS.G5,
    title: "첫 외부 유입",
    openDay: 21,
    enforceDay: 22,
    blockedStep: null,
  }),
  [GATE_IDS.G6]: Object.freeze({
    gateId: GATE_IDS.G6,
    title: "revenue 검증 상태",
    openDay: 28,
    enforceDay: null,
    blockedStep: null,
  }),
  [GATE_IDS.G7]: Object.freeze({
    gateId: GATE_IDS.G7,
    title: "Final Decision",
    openDay: 30,
    enforceDay: null,
    blockedStep: null,
  }),
});

/** Gates with an evaluator wired in this build. */
export const EVALUATED_GATE_IDS = Object.freeze([
  GATE_IDS.G1,
  GATE_IDS.G2,
  GATE_IDS.G4,
  GATE_IDS.G5,
  GATE_IDS.G6,
  GATE_IDS.G7,
]);

/**
 * 치환 테이블 (§15.3, Gate Engine 소유): milestone 실패 시 targetDays의
 * 미션을 회복 미션으로 대체한다. Rows are recorded once per failed gate into
 * gate-ledger `substitutions[]`; mission cards consume them (§11.1).
 */
export const GATE_SUBSTITUTION_TABLE = Object.freeze({
  [GATE_IDS.G2]: Object.freeze([
    Object.freeze({
      day: 8,
      replacementMissionId: "g2-recovery-interview-rerun",
      replacedMission: "인터뷰 재실행 + foundation 마감(go-no-go 재작성)",
      exitCondition: "인터뷰 strong ≥1 + dayDecision 기록",
    }),
    Object.freeze({
      day: 9,
      replacementMissionId: "g2-recovery-foundation-close",
      replacedMission: "인터뷰 재실행 + foundation 마감(go-no-go 재작성)",
      exitCondition: "인터뷰 strong ≥1 + dayDecision 기록",
    }),
  ]),
  [GATE_IDS.G4]: Object.freeze([
    Object.freeze({
      day: 15,
      replacementMissionId: "g4-recovery-ask-resend",
      replacedMission: "유료 ask 재작성+발송",
      exitCondition: "paymentIntent strong ≥1 + HogQL first_value ≥1행",
    }),
    Object.freeze({
      day: 16,
      replacementMissionId: "g4-recovery-instrumentation",
      replacedMission: "first_value 계측 삽입",
      exitCondition: "paymentIntent strong ≥1 + HogQL first_value ≥1행",
    }),
  ]),
  [GATE_IDS.G5]: Object.freeze([
    Object.freeze({
      day: 22,
      replacementMissionId: "g5-recovery-channel-reselect",
      replacedMission: "채널 재선정 + 첫 포스트/outreach 재실행",
      exitCondition: "traffic 자동 증거 + active user ≥1",
    }),
    Object.freeze({
      day: 23,
      replacementMissionId: "g5-recovery-outreach-rerun",
      replacedMission: "채널 재선정 + 첫 포스트/outreach 재실행",
      exitCondition: "traffic 자동 증거 + active user ≥1",
    }),
  ]),
  [GATE_IDS.G6]: Object.freeze([
    Object.freeze({
      day: 29,
      replacementMissionId: "g6-recovery-ask-and-refusal",
      replacedMission: "ask 재발송 + 결제/거절 원문 수집 삽입",
      exitCondition: "paymentRecord 또는 명시적 거절 원문",
    }),
  ]),
  [GATE_IDS.G7]: Object.freeze([
    Object.freeze({
      day: 30,
      replacementMissionId: "g7-graduation-hold",
      replacedMission: "graduation 보류 미션(근거 증거 참조 보강)",
      exitCondition: "근거 증거 참조 ≥3",
    }),
  ]),
});

/**
 * Substitution rows due for recording (§11.1/§15.3): a hard-blocking gate
 * contributes its rows while blocked; warning-style gates (G6/G7,
 * enforceDay=null) contribute once their objective day passed without a
 * pass. Rows already in the ledger (same gate) are skipped — idempotent.
 */
export function resolveDueSubstitutions({ evaluation = {}, ledger = {}, now = new Date() } = {}) {
  const day = normalizeDay(evaluation?.currentDay ?? evaluation?.current_day) ?? 1;
  const existing = new Set(
    asArray(ledger?.substitutions).map((entry) => entry.failedGate ?? entry.failed_gate),
  );
  const due = [];
  for (const [gateId, rows] of Object.entries(GATE_SUBSTITUTION_TABLE)) {
    if (existing.has(gateId)) continue;
    const gate = evaluation?.gates?.[gateId];
    if (!gate) continue;
    const definition = GATE_DEFINITIONS[gateId];
    const failed = definition.enforceDay !== null
      ? gate.state === GATE_STATES.blocked && !(gate.provisional?.active === true)
      : day > definition.openDay && gate.state !== GATE_STATES.passed;
    if (!failed) continue;
    for (const row of rows) {
      due.push({
        day: row.day,
        failedGate: gateId,
        replacedMission: row.replacedMission,
        replacementMissionId: row.replacementMissionId,
        exitCondition: row.exitCondition,
        reason: `${gateId}_failed`,
        recordedAt: toIso(now),
      });
    }
  }
  return due;
}

export function resolveGateLedgerPath(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "gate-ledger.json");
}

export function makeDefaultGateLedger(now = new Date()) {
  const generatedAt = toIso(now);
  return {
    schemaVersion: GATE_LEDGER_SCHEMA_VERSION,
    schema_version: GATE_LEDGER_SCHEMA_VERSION,
    schema: GATE_LEDGER_SCHEMA,
    createdAt: generatedAt,
    created_at: generatedAt,
    updatedAt: generatedAt,
    updated_at: generatedAt,
    gates: {},
    adaptiveEvents: [],
    adaptive_events: [],
    substitutions: [],
  };
}

export async function loadGateLedger({ workspaceRoot, fsImpl = fs } = {}) {
  if (!workspaceRoot) return makeDefaultGateLedger();
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveGateLedgerPath(workspaceRoot), "utf8"));
    return normalizeGateLedger(raw);
  } catch {
    return makeDefaultGateLedger();
  }
}

export async function saveGateLedger({ workspaceRoot, ledger, now = new Date() } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("saveGateLedger requires workspaceRoot.");
  }
  const filePath = resolveGateLedgerPath(workspaceRoot);
  const normalized = normalizeGateLedger({ ...ledger, updatedAt: toIso(now) });
  return withFileLock(filePath, async () => {
    await atomicWriteJson(filePath, normalized);
    return normalized;
  });
}

export function normalizeGateLedger(value = {}) {
  const raw = objectOrEmpty(value);
  const fallback = makeDefaultGateLedger();
  const createdAt = normalizeIso(raw.createdAt ?? raw.created_at, fallback.createdAt);
  const updatedAt = normalizeIso(raw.updatedAt ?? raw.updated_at, createdAt);
  const gates = {};
  for (const [gateId, entry] of Object.entries(objectOrEmpty(raw.gates))) {
    if (!GATE_DEFINITIONS[gateId]) continue;
    gates[gateId] = normalizeGateRecord(gateId, entry);
  }
  const adaptiveEvents = asArray(raw.adaptiveEvents ?? raw.adaptive_events)
    .map(normalizeAdaptiveEvent)
    .filter(Boolean)
    .slice(-ADAPTIVE_EVENT_LIMIT);
  const substitutions = asArray(raw.substitutions)
    .map((entry, index) => ({ entry: normalizeSubstitution(entry), index }))
    .filter(({ entry }) => Boolean(entry))
    .sort(compareSubstitutionEntries)
    .slice(-SUBSTITUTION_LIMIT);
  return {
    schemaVersion: GATE_LEDGER_SCHEMA_VERSION,
    schema_version: GATE_LEDGER_SCHEMA_VERSION,
    schema: GATE_LEDGER_SCHEMA,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
    gates,
    adaptiveEvents,
    adaptive_events: adaptiveEvents,
    substitutions: substitutions.map(({ entry }) => entry),
  };
}

/**
 * G5① traffic signal derived from the proof ledger (§10.2): the latest
 * completed `traffic_snapshot` proof event maps to `{ observed }`. This is the
 * manual/proof-based traffic input path — when no live traffic collector is
 * wired into a call site (e.g. the day_progress_patch gate), this lets a
 * verified traffic proof flow into `evaluateProgramGates`/`traffic` without
 * touching the gate's threshold logic. Returns null when no traffic_snapshot
 * proof exists — a missing measurement is a source gap (§21), never a real
 * zero, so the gate stays on the provisional path rather than hard-blocking.
 */
export function latestTrafficSignalFromProofs(proofLedger = {}) {
  const events = Array.isArray(proofLedger?.events) ? proofLedger.events : [];
  let latest = null;
  for (const event of events) {
    const type = String(event?.type ?? event?.eventType ?? event?.event_type ?? "");
    if (type !== PROOF_EVENT_TYPES.trafficSnapshot) continue;
    if (!COMPLETED_STATUSES.has(String(event?.status ?? ""))) continue;
    const createdAt = Date.parse(String(event?.createdAt ?? event?.created_at ?? ""));
    const at = Number.isFinite(createdAt) ? createdAt : Number.NEGATIVE_INFINITY;
    if (!latest || at >= latest.at) {
      const observedValue = event?.metadata?.observed
        ?? event?.metadata?.traffic_observed
        ?? event?.metadata?.trafficObserved;
      // A completed traffic_snapshot is positive evidence of traffic by
      // default; only an explicit `observed:false` marker reads as zero.
      const observed = observedValue === undefined || observedValue === null
        ? true
        : observedValue === true || String(observedValue).toLowerCase() === "true";
      latest = { at, observed };
    }
  }
  return latest ? { observed: latest.observed } : null;
}

/**
 * Pure milestone gate evaluation (§10.2). Inputs:
 * - proofLedger: proof ledger document (normalized internally).
 * - currentDay: day number whose entry is being considered.
 * - firstValue: `{ observed, rowCount?, checkedAt? }` from the active-user
 *   snapshot pipeline (§15.4) or null when the source has not reported.
 * - traffic: `{ observed }` live/manual traffic input or null (source gap).
 * - sources: `{ posthogAvailable: boolean|null }` source-gate availability.
 * - previousGates: prior ledger `gates` map (token + provisional continuity).
 */
export function evaluateProgramGates({
  proofLedger = null,
  currentDay = 1,
  firstValue = null,
  traffic = null,
  sources = {},
  previousGates = {},
  now = new Date(),
} = {}) {
  const ledger = normalizeProofLedger(proofLedger ?? {}, { now });
  const day = normalizeDay(currentDay) ?? 1;
  const evaluatedAt = toIso(now);
  const events = ledger.events;
  const gates = {};

  const interviewStrong = events.some((event) =>
    event.type === PROOF_EVENT_TYPES.interview && isStrongCompleted(event),
  );

  gates[GATE_IDS.G1] = finalizeGate({
    definition: GATE_DEFINITIONS.G1,
    day,
    evaluatedAt,
    previous: previousGates?.[GATE_IDS.G1],
    conditions: [
      {
        id: "interview_strong_evidence",
        label: "인터뷰 strong 증거 ≥1 (accepted|verified)",
        satisfied: interviewStrong,
      },
    ],
    now,
  });

  const closure = evaluateFoundationClosure({ proofLedger: ledger, currentDay: day, now });
  gates[GATE_IDS.G2] = finalizeGate({
    definition: GATE_DEFINITIONS.G2,
    day,
    evaluatedAt,
    previous: previousGates?.[GATE_IDS.G2],
    conditions: [
      {
        id: "foundation_closure_closed",
        label: "foundation closure status=closed",
        satisfied: closure.status === "closed",
      },
      {
        id: "interview_strong_evidence",
        label: "인터뷰 strong 증거 ≥1",
        satisfied: interviewStrong,
      },
      {
        id: "day7_decision_recorded",
        label: "Day 7 dayDecision 기록 (continue/pivot/stop/restart)",
        satisfied: closure.day7DecisionCompleted === true,
      },
    ],
    now,
  });

  const paidAskStrong = events.some((event) =>
    event.type === PROOF_EVENT_TYPES.paymentIntent && isStrongCompleted(event),
  );
  const firstValueCondition = evaluateFirstValueCondition({ firstValue, sources });
  gates[GATE_IDS.G4] = finalizeGate({
    definition: GATE_DEFINITIONS.G4,
    day,
    evaluatedAt,
    previous: previousGates?.[GATE_IDS.G4],
    conditions: [
      {
        id: "paid_ask_strong_evidence",
        label: "유료 ask 발송 증거 ≥1 (paymentIntent, strong)",
        satisfied: paidAskStrong,
      },
      {
        id: "first_value_observed",
        label: "사용자 제품 PostHog first_value 이벤트 ≥1행 (HogQL 자동)",
        satisfied: firstValueCondition.satisfied,
        sourceUnavailable: firstValueCondition.sourceUnavailable,
      },
    ],
    now,
  });

  // G5 첫 외부 유입 (§10.2): ① traffic 자동 증거 ② active user ≥1 — 모두
  // 자동 집계 전용. traffic은 최신 trafficSnapshot proof 이벤트 또는 라이브 입력.
  const trafficSignal = traffic ?? latestTrafficSignalFromProofs(ledger);
  // 미수집(null) ≠ 유입 0: a missing measurement is a source gap (§21
  // provisional path), never a genuine zero. Only an actual zero reading
  // (`observed: false`) blocks for real.
  const trafficCondition = trafficSignal?.observed === true
    ? { satisfied: true, sourceUnavailable: false }
    : trafficSignal == null
      ? { satisfied: false, sourceUnavailable: true }
      : { satisfied: false, sourceUnavailable: false };
  const activeUserCondition = firstValue && Number(firstValue.rowCount) >= 1
    ? { satisfied: true, sourceUnavailable: false }
    : evaluateFirstValueCondition({ firstValue, sources });
  gates[GATE_IDS.G5] = finalizeGate({
    definition: GATE_DEFINITIONS.G5,
    day,
    evaluatedAt,
    previous: previousGates?.[GATE_IDS.G5],
    conditions: [
      {
        id: "traffic_observed",
        label: "traffic 자동 증거 ≥1 (Cloudflare/PostHog)",
        satisfied: trafficCondition.satisfied,
        sourceUnavailable: trafficCondition.sourceUnavailable,
      },
      {
        id: "active_user_observed",
        label: "active user ≥1 (HogQL 자동 집계)",
        satisfied: activeUserCondition.satisfied,
        sourceUnavailable: activeUserCondition.sourceUnavailable,
      },
    ],
    now,
  });

  // G6 revenue 검증 상태 (§10.2, 비차단): paymentRecord ≥1 또는
  // (paymentIntent strong ≥3 + 명시적 거절 기록).
  const paymentRecordStrong = events.some((event) =>
    event.type === PROOF_EVENT_TYPES.paymentRecord && isStrongCompleted(event),
  );
  const paidAskStrongCount = events.filter((event) =>
    event.type === PROOF_EVENT_TYPES.paymentIntent && isStrongCompleted(event),
  ).length;
  const refusalRecorded = events.some((event) =>
    event.type === PROOF_EVENT_TYPES.paymentFailure
      && COMPLETED_STATUSES.has(String(event.status || ""))
      && String(event.metadata?.kind ?? event.metadata?.revenue_kind ?? "") === "refusal",
  );
  gates[GATE_IDS.G6] = finalizeGate({
    definition: GATE_DEFINITIONS.G6,
    day,
    evaluatedAt,
    previous: previousGates?.[GATE_IDS.G6],
    conditions: [
      {
        id: "revenue_validation_state",
        label: "paymentRecord ≥1 또는 (paymentIntent strong ≥3 + 명시적 거절 기록)",
        satisfied: paymentRecordStrong || (paidAskStrongCount >= 3 && refusalRecorded),
      },
    ],
    now,
  });

  // G7 Final Decision (§10.2): Day 30 dayDecision + 근거 증거 참조 ≥3
  // (anti-validation: 결정 없는 완주 불인정).
  const finalDecision = events.some((event) =>
    event.type === PROOF_EVENT_TYPES.dayDecision
      && Number(event.day) >= 30
      && COMPLETED_STATUSES.has(String(event.status || ""))
      && Boolean(event.decision)
      && (Array.isArray(event.refs) ? event.refs.length : 0) >= 3,
  );
  gates[GATE_IDS.G7] = finalizeGate({
    definition: GATE_DEFINITIONS.G7,
    day,
    evaluatedAt,
    previous: previousGates?.[GATE_IDS.G7],
    conditions: [
      {
        id: "final_decision_with_evidence_refs",
        label: "continue/pivot/stop 결정 + 근거 증거 참조 ≥3 (Day 30 dayDecision)",
        satisfied: finalDecision,
      },
    ],
    now,
  });

  return {
    schemaVersion: GATE_LEDGER_SCHEMA_VERSION,
    schema: "agentic30.program_gate_evaluation.v1",
    evaluatedAt,
    evaluated_at: evaluatedAt,
    currentDay: day,
    current_day: day,
    gates,
    blockingGate: resolveBlockingGate({ gates, targetDay: day }),
    expiredTokenGateIds: Object.values(gates)
      .filter((gate) => gate.tokenExpiredNow)
      .map((gate) => gate.gateId),
  };
}

/**
 * First blocking milestone gate for entering `targetDay`, honoring the
 * provisional overlay (§21: day progression allowed while active, gate pass
 * never granted). Returns the gate record or null.
 */
export function resolveBlockingGate({ gates = {}, targetDay = 1 } = {}) {
  const day = normalizeDay(targetDay) ?? 1;
  const ordered = Object.values(GATE_IDS)
    .map((gateId) => gates[gateId])
    .filter(Boolean);
  for (const gate of ordered) {
    const definition = GATE_DEFINITIONS[gate.gateId];
    if (!definition || definition.enforceDay === null) continue;
    if (day < definition.enforceDay) continue;
    if (gate.state !== GATE_STATES.blocked) continue;
    if (gate.provisional?.active === true) continue;
    return gate;
  }
  return null;
}

/**
 * Merges a pure evaluation into the persisted ledger: state transitions set
 * `since`, evaluation history is appended (capped), expired tokens are
 * stamped. Returns the next ledger document (no IO).
 */
export function applyGateEvaluation(ledgerInput, evaluation, { now = new Date() } = {}) {
  const ledger = normalizeGateLedger(ledgerInput);
  const evaluatedAt = evaluation?.evaluatedAt ?? toIso(now);
  const gates = { ...ledger.gates };
  for (const [gateId, gate] of Object.entries(objectOrEmpty(evaluation?.gates))) {
    if (!GATE_DEFINITIONS[gateId]) continue;
    const previous = gates[gateId] ?? null;
    const since = previous && previous.state === gate.state ? previous.since : evaluatedAt;
    const previousToken = previous?.interventionToken ?? null;
    const interventionToken = gate.tokenExpiredNow && previousToken
      ? { ...previousToken, expired: true, expiredAt: evaluatedAt }
      : gate.interventionToken ?? previousToken;
    const evaluations = [
      ...asArray(previous?.evaluations),
      {
        evaluatedAt,
        state: gate.state,
        blockedReason: gate.blockedReason ?? "",
        resolutionPath: gate.resolutionPath ?? "",
      },
    ].slice(-EVALUATION_HISTORY_LIMIT);
    gates[gateId] = normalizeGateRecord(gateId, {
      ...gate,
      since,
      interventionToken,
      evaluations,
    });
  }
  return normalizeGateLedger({
    ...ledger,
    updatedAt: evaluatedAt,
    gates,
  });
}

/**
 * Convenience read-evaluate-persist cycle. Loads the proof ledger when not
 * provided, evaluates under the gate-ledger file lock, persists, and returns
 * `{ ledger, evaluation }`.
 */
export async function evaluateAndRecordProgramGates({
  workspaceRoot,
  proofLedger = null,
  currentDay = 1,
  firstValue = null,
  traffic = null,
  sources = {},
  now = new Date(),
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("evaluateAndRecordProgramGates requires workspaceRoot.");
  }
  const proofs = proofLedger ?? await loadProofLedger({ workspaceRoot });
  const filePath = resolveGateLedgerPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const current = await loadGateLedger({ workspaceRoot });
    const previousStates = Object.fromEntries(
      Object.entries(current.gates).map(([gateId, gate]) => [gateId, gate.state]),
    );
    const evaluation = evaluateProgramGates({
      proofLedger: proofs,
      currentDay,
      firstValue,
      traffic,
      sources,
      previousGates: current.gates,
      now,
    });
    const next = applyGateEvaluation(current, evaluation, { now });
    await atomicWriteJson(filePath, next);
    return { ledger: next, evaluation, previousStates };
  });
}

/**
 * Authoritative milestone check for a day_progress_patch (spec §10.1: evaluated
 * right before the patch; the handler in index.mjs stays the authority seat).
 * A gate with a `blockedStep` (G1 → goal) only withholds that step and the
 * steps after it in the day's step order; gates without one withhold the whole
 * day. Returns `{ blocked, gate, evaluation, stateChanged }`.
 */
export async function evaluateDayProgressPatchGate({
  workspaceRoot,
  day,
  stepId = "",
  firstValue = null,
  traffic = null,
  sources = {},
  now = new Date(),
} = {}) {
  const targetDay = normalizeDay(day);
  if (!workspaceRoot || typeof workspaceRoot !== "string" || targetDay === null) {
    return { blocked: false, gate: null, evaluation: null, stateChanged: false, previousStates: {} };
  }
  const { evaluation, previousStates } = await evaluateAndRecordProgramGates({
    workspaceRoot,
    currentDay: targetDay,
    firstValue,
    traffic,
    sources,
    now,
  });
  // Walk EVERY enforcing blocked gate in order: a step-scoped gate (G1 → goal)
  // exempting an earlier step must not shadow a later whole-day gate (e.g. G2
  // still blocks Day 8 scan even though G1 would exempt scan).
  const steps = targetDay === 1 ? DAY1_STEPS : STANDARD_STEPS;
  const patchIndex = steps.indexOf(String(stepId || ""));
  for (const gateId of Object.values(GATE_IDS)) {
    const gate = evaluation.gates[gateId];
    const definition = GATE_DEFINITIONS[gateId];
    if (!gate || !definition || definition.enforceDay === null) continue;
    if (targetDay < definition.enforceDay) continue;
    if (gate.state !== GATE_STATES.blocked) continue;
    if (gate.provisional?.active === true) continue;
    if (gate.blockedStep) {
      const gateIndex = steps.indexOf(gate.blockedStep);
      // Steps strictly before the gated step stay patchable; unknown steps
      // fall through to patchDayStep's own validation (it throws on them).
      if (gateIndex >= 0 && patchIndex >= 0 && patchIndex < gateIndex) continue;
    }
    const stateChanged = previousStates[gate.gateId] !== GATE_STATES.blocked;
    return { blocked: true, gate, evaluation, stateChanged, previousStates };
  }
  return { blocked: false, gate: null, evaluation, stateChanged: false, previousStates };
}

/**
 * Program phase (§14.1) derived from milestone passes — the clock keeps
 * running while the phase trails on blocked gates (시계·phase 분리).
 */
export function resolveProgramPhase(evaluation = {}) {
  const gates = evaluation?.gates ?? {};
  const passed = (gateId) => gates[gateId]?.state === GATE_STATES.passed;
  if (passed(GATE_IDS.G7)) return "graduated";
  if (passed(GATE_IDS.G5)) return "grow";
  if (passed(GATE_IDS.G4)) return "launch";
  if (passed(GATE_IDS.G2)) return "build";
  return "foundation";
}

/** First evaluated gate that has not passed yet (telemetry active_gate). */
export function resolveActiveGate(evaluation = {}) {
  const gates = evaluation?.gates ?? {};
  for (const gateId of Object.values(GATE_IDS)) {
    const gate = gates[gateId];
    if (!gate) continue;
    if (gate.state !== GATE_STATES.passed) return gate;
  }
  return null;
}

/** User-facing one-liner for a withheld day_progress_patch. */
export function buildGateBlockedMessage(gate = {}) {
  const evidence = asArray(gate.requiredEvidence)
    .map((entry) => entry.label || entry.id)
    .filter(Boolean)
    .join(" · ");
  const scope = gate.blockedStep
    ? `Day ${gate.enforceDay}+의 ${gate.blockedStep} 스텝`
    : `Day ${gate.enforceDay}+ 진입`;
  const evidencePart = evidence ? ` 필요한 증거: ${evidence}.` : "";
  return `${gate.gateId} ${gate.title} 게이트가 잠겨 있어 ${scope}이 차단됐어.${evidencePart} 증거를 제출하거나 confession으로 Office Hours를 여는 게 해제 경로야.`;
}

/** §13.4: 프로그램 전체 토큰 발급 누적 한도 — 초과 시 human escalation만 남는다. */
export const MAX_INTERVENTION_TOKENS = 3;

/**
 * Issues an Office Hours pass-through token (§13.4). At most one token per
 * gate for the whole program — re-blocking the same gate can never mint a
 * second token, expired or not — and at most MAX_INTERVENTION_TOKENS across
 * the whole program (beyond that only human escalation remains, §13.5).
 * Returns `{ issued, token, reason, ledger, totalIssued }`.
 */
export async function issueGateInterventionToken({
  workspaceRoot,
  gateId,
  dueDay,
  expectedEvidenceKind = "",
  now = new Date(),
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("issueGateInterventionToken requires workspaceRoot.");
  }
  if (!GATE_DEFINITIONS[gateId]) {
    throw new Error(`issueGateInterventionToken: unknown gateId ${gateId}`);
  }
  const due = normalizeDay(dueDay);
  if (due === null) {
    throw new Error("issueGateInterventionToken requires a valid dueDay.");
  }
  const activationDay = tokenActivationDay(GATE_DEFINITIONS[gateId]);
  if (due < activationDay) {
    const ledger = await loadGateLedger({ workspaceRoot });
    return {
      issued: false,
      reason: "token_before_gate_active",
      token: null,
      ledger,
      totalIssued: countIssuedInterventionTokens(ledger),
    };
  }
  const filePath = resolveGateLedgerPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const ledger = await loadGateLedger({ workspaceRoot });
    const record = ledger.gates[gateId] ?? normalizeGateRecord(gateId, {});
    if (record.interventionToken) {
      return {
        issued: false,
        reason: "token_already_issued",
        token: record.interventionToken,
        ledger,
        totalIssued: countIssuedInterventionTokens(ledger),
      };
    }
    if (countIssuedInterventionTokens(ledger) >= MAX_INTERVENTION_TOKENS) {
      return {
        issued: false,
        reason: "escalation_required",
        token: null,
        ledger,
        totalIssued: countIssuedInterventionTokens(ledger),
      };
    }
    const token = {
      gateId,
      issuedAt: toIso(now),
      dueDay: due,
      expectedEvidenceKind: cleanString(expectedEvidenceKind, 80),
      expired: false,
      expiredAt: null,
    };
    const next = normalizeGateLedger({
      ...ledger,
      updatedAt: toIso(now),
      gates: {
        ...ledger.gates,
        [gateId]: { ...record, interventionToken: token },
      },
    });
    await atomicWriteJson(filePath, next);
    return {
      issued: true,
      reason: "",
      token,
      ledger: next,
      totalIssued: countIssuedInterventionTokens(next),
    };
  });
}

/** Program-wide issued token count (§13.4: >3 → human escalation only). */
export function countIssuedInterventionTokens(ledger = {}) {
  return Object.values(objectOrEmpty(ledger.gates))
    .filter((gate) => gate?.interventionToken)
    .length;
}

/** Appends an adaptive-rule event (§15.3 adaptiveEvents[], capped). */
export async function recordGateAdaptiveEvent({ workspaceRoot, event, now = new Date() } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("recordGateAdaptiveEvent requires workspaceRoot.");
  }
  const normalized = normalizeAdaptiveEvent({ firedAt: toIso(now), ...objectOrEmpty(event) });
  if (!normalized) throw new Error("recordGateAdaptiveEvent requires a ruleId.");
  const filePath = resolveGateLedgerPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const ledger = await loadGateLedger({ workspaceRoot });
    const next = normalizeGateLedger({
      ...ledger,
      updatedAt: toIso(now),
      adaptiveEvents: [...ledger.adaptiveEvents, normalized],
    });
    await atomicWriteJson(filePath, next);
    return { ledger: next, event: normalized };
  });
}

/** Appends a mission substitution record (§15.3 substitutions[], capped). */
export async function recordMissionSubstitution({ workspaceRoot, substitution, now = new Date() } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("recordMissionSubstitution requires workspaceRoot.");
  }
  const normalized = normalizeSubstitution(objectOrEmpty(substitution));
  if (!normalized) throw new Error("recordMissionSubstitution requires day and reason.");
  const filePath = resolveGateLedgerPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const ledger = await loadGateLedger({ workspaceRoot });
    const next = normalizeGateLedger({
      ...ledger,
      updatedAt: toIso(now),
      substitutions: [...ledger.substitutions, normalized],
    });
    await atomicWriteJson(filePath, next);
    return { ledger: next, substitution: normalized };
  });
}

function finalizeGate({ definition, day, evaluatedAt, previous = null, conditions = [], now }) {
  const unmet = conditions.filter((condition) => condition.satisfied !== true);
  const evidenceMet = unmet.length === 0;
  const unavailableOnly = unmet.length > 0
    && unmet.every((condition) => condition.sourceUnavailable === true);
  const token = previous?.interventionToken ?? null;
  const activationDay = tokenActivationDay(definition);
  const tokenEligible = Boolean(token && day >= activationDay);
  const tokenActive = Boolean(tokenEligible && token.expired !== true && day <= token.dueDay);
  const tokenExpiredNow = Boolean(tokenEligible && token.expired !== true && day > token.dueDay && !evidenceMet);

  let state;
  let blockedReason = "";
  let resolutionPath = "";
  let provisional = null;

  if (evidenceMet) {
    state = GATE_STATES.passed;
    resolutionPath = GATE_RESOLUTION_PATHS.evidence;
  } else if (tokenActive) {
    // §13.4: confession token passes the gate until dueDay; expiry below
    // re-blocks it and the token can never be reissued.
    state = GATE_STATES.passed;
    resolutionPath = GATE_RESOLUTION_PATHS.confessionToken;
  } else if (definition.enforceDay !== null && day >= definition.enforceDay) {
    state = GATE_STATES.blocked;
    blockedReason = tokenExpiredNow
      ? "intervention_token_expired"
      : unavailableOnly
        ? "source_unavailable"
        : unmet[0]?.id ?? "conditions_unmet";
    if (unavailableOnly) {
      // §21 provisional overlay: every evidence condition met except
      // source-dependent ones whose source is down. 3-day grace for day
      // progression only.
      const since = previous?.provisional?.since ?? evaluatedAt;
      const ageMs = Date.parse(evaluatedAt) - Date.parse(since);
      provisional = {
        since,
        maxDays: PROVISIONAL_MAX_DAYS,
        active: Number.isFinite(ageMs) && ageMs < PROVISIONAL_MAX_DAYS * DAY_MS,
      };
    }
  } else if (day >= definition.openDay) {
    state = GATE_STATES.open;
    blockedReason = "";
  } else {
    state = GATE_STATES.locked;
  }

  return {
    gateId: definition.gateId,
    gate_id: definition.gateId,
    title: definition.title,
    state,
    blockedReason,
    blocked_reason: blockedReason,
    resolutionPath,
    resolution_path: resolutionPath,
    requiredEvidence: unmet.map((condition) => ({
      id: condition.id,
      label: condition.label,
    })),
    required_evidence: unmet.map((condition) => ({
      id: condition.id,
      label: condition.label,
    })),
    conditions: conditions.map((condition) => ({
      id: condition.id,
      label: condition.label,
      satisfied: condition.satisfied === true,
      sourceUnavailable: condition.sourceUnavailable === true,
    })),
    openDay: definition.openDay,
    open_day: definition.openDay,
    enforceDay: definition.enforceDay,
    enforce_day: definition.enforceDay,
    blockedStep: definition.blockedStep,
    blocked_step: definition.blockedStep,
    evaluatedAt,
    evaluated_at: evaluatedAt,
    provisional,
    interventionToken: token,
    tokenExpiredNow,
  };
}

function evaluateFirstValueCondition({ firstValue = null, sources = {} } = {}) {
  if (firstValue && firstValue.observed === true) {
    return { satisfied: true, sourceUnavailable: false };
  }
  const posthogAvailable = sources?.posthogAvailable;
  if (firstValue == null || posthogAvailable === false) {
    // Source has not reported / is down: not satisfiable right now, but the
    // miss is environmental, so it qualifies for the §21 provisional overlay.
    return { satisfied: false, sourceUnavailable: true };
  }
  return { satisfied: false, sourceUnavailable: false };
}

function isStrongCompleted(event = {}) {
  return event.strength === "strong" && COMPLETED_STATUSES.has(String(event.status || ""));
}

function normalizeGateRecord(gateId, value = {}) {
  const raw = objectOrEmpty(value);
  const definition = GATE_DEFINITIONS[gateId];
  const stateToken = String(raw.state || "");
  const state = Object.values(GATE_STATES).includes(stateToken) ? stateToken : GATE_STATES.locked;
  const token = normalizeToken(raw.interventionToken ?? raw.intervention_token, gateId);
  const provisional = normalizeProvisional(raw.provisional);
  const evaluations = asArray(raw.evaluations)
    .map((entry) => ({
      evaluatedAt: normalizeIso(entry?.evaluatedAt ?? entry?.evaluated_at, ""),
      state: cleanString(entry?.state, 40),
      blockedReason: cleanString(entry?.blockedReason ?? entry?.blocked_reason, 120),
      resolutionPath: cleanString(entry?.resolutionPath ?? entry?.resolution_path, 40),
    }))
    .filter((entry) => entry.evaluatedAt)
    .slice(-EVALUATION_HISTORY_LIMIT);
  const requiredEvidence = asArray(raw.requiredEvidence ?? raw.required_evidence)
    .map((entry) => ({
      id: cleanString(entry?.id, 80),
      label: cleanString(entry?.label, 200),
    }))
    .filter((entry) => entry.id);
  return {
    gateId,
    gate_id: gateId,
    title: definition?.title ?? gateId,
    state,
    since: normalizeIso(raw.since, ""),
    blockedReason: cleanString(raw.blockedReason ?? raw.blocked_reason, 120),
    blocked_reason: cleanString(raw.blockedReason ?? raw.blocked_reason, 120),
    resolutionPath: cleanString(raw.resolutionPath ?? raw.resolution_path, 40),
    resolution_path: cleanString(raw.resolutionPath ?? raw.resolution_path, 40),
    requiredEvidence,
    required_evidence: requiredEvidence,
    evaluatedAt: normalizeIso(raw.evaluatedAt ?? raw.evaluated_at, ""),
    evaluated_at: normalizeIso(raw.evaluatedAt ?? raw.evaluated_at, ""),
    provisional,
    interventionToken: token,
    intervention_token: token,
    evaluations,
  };
}

function normalizeToken(value, gateId) {
  const raw = objectOrEmpty(value);
  if (!Object.keys(raw).length) return null;
  const dueDay = normalizeDay(raw.dueDay ?? raw.due_day);
  if (dueDay === null) return null;
  return {
    gateId: cleanString(raw.gateId ?? raw.gate_id, 8) || gateId,
    issuedAt: normalizeIso(raw.issuedAt ?? raw.issued_at, ""),
    dueDay,
    expectedEvidenceKind: cleanString(raw.expectedEvidenceKind ?? raw.expected_evidence_kind, 80),
    expired: raw.expired === true,
    expiredAt: raw.expiredAt || raw.expired_at
      ? normalizeIso(raw.expiredAt ?? raw.expired_at, "")
      : null,
  };
}

function normalizeProvisional(value) {
  const raw = objectOrEmpty(value);
  if (!Object.keys(raw).length) return null;
  const since = normalizeIso(raw.since, "");
  if (!since) return null;
  return {
    since,
    maxDays: PROVISIONAL_MAX_DAYS,
    active: raw.active === true,
  };
}

function normalizeAdaptiveEvent(value = {}) {
  const raw = objectOrEmpty(value);
  const ruleId = cleanString(raw.ruleId ?? raw.rule_id, 16);
  if (!ruleId) return null;
  return {
    ruleId,
    rule_id: ruleId,
    firedAt: normalizeIso(raw.firedAt ?? raw.fired_at, new Date().toISOString()),
    fired_at: normalizeIso(raw.firedAt ?? raw.fired_at, new Date().toISOString()),
    signals: sanitizeShallowObject(raw.signals),
    userLabel: raw.userLabel === undefined && raw.user_label === undefined
      ? null
      : cleanString(raw.userLabel ?? raw.user_label, 40) || null,
    user_label: raw.userLabel === undefined && raw.user_label === undefined
      ? null
      : cleanString(raw.userLabel ?? raw.user_label, 40) || null,
    labeledAt: normalizeIso(raw.labeledAt ?? raw.labeled_at ?? raw.labelAt ?? raw.label_at, ""),
    labeled_at: normalizeIso(raw.labeledAt ?? raw.labeled_at ?? raw.labelAt ?? raw.label_at, ""),
    labelAt: normalizeIso(raw.labelAt ?? raw.label_at ?? raw.labeledAt ?? raw.labeled_at, ""),
    label_at: normalizeIso(raw.labelAt ?? raw.label_at ?? raw.labeledAt ?? raw.labeled_at, ""),
  };
}

function normalizeSubstitution(value = {}) {
  const raw = objectOrEmpty(value);
  const day = normalizeDay(raw.day);
  const reason = cleanString(raw.reason, 120);
  if (day === null || !reason) return null;
  return {
    day,
    failedGate: cleanString(raw.failedGate ?? raw.failed_gate, 8),
    failed_gate: cleanString(raw.failedGate ?? raw.failed_gate, 8),
    replacedMission: cleanString(raw.replacedMission ?? raw.replaced_mission, 300),
    replaced_mission: cleanString(raw.replacedMission ?? raw.replaced_mission, 300),
    shortTitle: cleanString(raw.shortTitle ?? raw.short_title, 80),
    short_title: cleanString(raw.shortTitle ?? raw.short_title, 80),
    summary: cleanString(raw.summary, 600),
    tasks: normalizeStringArray(raw.tasks, 20, 300),
    output: cleanString(raw.output, 300),
    replacementMissionId: cleanString(raw.replacementMissionId ?? raw.replacement_mission_id, 120),
    replacement_mission_id: cleanString(raw.replacementMissionId ?? raw.replacement_mission_id, 120),
    exitCondition: cleanString(raw.exitCondition ?? raw.exit_condition, 300),
    exit_condition: cleanString(raw.exitCondition ?? raw.exit_condition, 300),
    reason,
    recordedAt: normalizeIso(raw.recordedAt ?? raw.recorded_at, new Date().toISOString()),
    recorded_at: normalizeIso(raw.recordedAt ?? raw.recorded_at, new Date().toISOString()),
  };
}

function sanitizeShallowObject(value) {
  const raw = objectOrEmpty(value);
  const output = {};
  for (const [key, nested] of Object.entries(raw)) {
    const cleanKey = cleanString(key, 80);
    if (!cleanKey) continue;
    if (typeof nested === "number" || typeof nested === "boolean" || nested === null) {
      output[cleanKey] = nested;
    } else if (typeof nested === "string") {
      output[cleanKey] = cleanString(nested, 300);
    } else if (Array.isArray(nested)) {
      output[cleanKey] = nested.slice(0, 20).map((item) =>
        typeof item === "string" ? cleanString(item, 300) : item,
      );
    }
  }
  return output;
}

function compareSubstitutionEntries(a, b) {
  const aTime = Date.parse(String(a.entry.recordedAt ?? a.entry.recorded_at ?? ""));
  const bTime = Date.parse(String(b.entry.recordedAt ?? b.entry.recorded_at ?? ""));
  const left = Number.isFinite(aTime) ? aTime : Number.NEGATIVE_INFINITY;
  const right = Number.isFinite(bTime) ? bTime : Number.NEGATIVE_INFINITY;
  if (left !== right) return left - right;
  return a.index - b.index;
}

function tokenActivationDay(definition = {}) {
  return normalizeDay(definition.enforceDay ?? definition.enforce_day ?? definition.openDay ?? definition.open_day) ?? 1;
}

function normalizeStringArray(value = [], limit = 20, maxLength = 300) {
  return asArray(value)
    .map((entry) => cleanString(entry, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeDay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const day = Math.trunc(number);
  return day >= 0 && day <= 400 ? day : null;
}

function normalizeIso(value, fallback) {
  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return fallback;
}

function cleanString(value = "", maxLength = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

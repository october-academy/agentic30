import test from "node:test";
import assert from "node:assert/strict";

import { buildRevenueOrActivationGateCard } from "../sidecar/program-gate-card.mjs";
import { GATE_IDS, GATE_STATES, evaluateProgramGates } from "../sidecar/program-gate-engine.mjs";

const T0 = new Date("2026-06-12T09:00:00.000Z");

function foundationClosedEvents() {
  return [
    { id: "supporting-1", type: "landing_metric", day: 6, status: "verified", strength: "medium", polarity: "supporting" },
    { id: "counter-1", type: "interview", day: 5, status: "verified", strength: "strong", polarity: "counter" },
    { id: "decision-1", type: "day_decision", day: 7, status: "accepted", decision: "continue" },
  ];
}

function scoreboardSnapshot(programDay, { activeUsers100 = {}, firstRevenue = {} } = {}) {
  return {
    type: "program_scoreboard_snapshot",
    schemaVersion: 1,
    programDay,
    scoreboards: {
      activeUsers100: {
        acceptedCount: 0,
        excludedCounts: {},
        sourceState: "ready",
        nextUnblockAction: "activation friction fix workpack",
        ...activeUsers100,
      },
      firstRevenue: {
        acceptedCount: 0,
        excludedCounts: {},
        learningCounts: {},
        sourceState: "ready",
        nextUnblockAction: "offer/paid ask follow-up plan",
        ...firstRevenue,
      },
    },
  };
}

test("G4 revenue_or_activation_gate exposes missing first_value source", async () => {
  const proofLedger = {
    events: [
      ...foundationClosedEvents(),
      { id: "ask-1", type: "payment_intent", day: 14, status: "accepted", strength: "strong" },
    ],
  };
  const evaluation = evaluateProgramGates({
    proofLedger,
    currentDay: 15,
    firstValue: null,
    sources: { posthogAvailable: false },
    now: T0,
  });

  const card = await buildRevenueOrActivationGateCard({
    gateId: GATE_IDS.G4,
    evaluation,
    proofLedger,
    scoreboardSnapshot: scoreboardSnapshot(15, {
      activeUsers100: {
        sourceState: "missing",
        nextUnblockAction: "first_value instrumentation snippet",
      },
      firstRevenue: {
        learningCounts: { paymentIntent: 1 },
        sourceState: "manual_proof_required",
      },
    }),
  });

  assert.equal(card.type, "revenue_or_activation_gate");
  assert.equal(card.gate, GATE_IDS.G4);
  assert.equal(card.satisfied, false);
  assert.equal(card.sourceState, "missing");
  assert.deepEqual(card.requires, ["first_value", "paymentIntent"]);
  assert.ok(card.blockingReasons.includes("missing first_value source"));
  assert.equal(card.recoveryBranch, "g4-recovery-instrumentation");
});

test("G5 revenue_or_activation_gate exposes source-unavailable traffic state", async () => {
  const evaluation = evaluateProgramGates({
    proofLedger: { events: [] },
    currentDay: 22,
    traffic: null,
    firstValue: { observed: true, rowCount: 1 },
    sources: { posthogAvailable: true, cloudflareAvailable: true },
    now: T0,
  });

  const card = await buildRevenueOrActivationGateCard({
    gateId: GATE_IDS.G5,
    evaluation,
    scoreboardSnapshot: scoreboardSnapshot(22, {
      activeUsers100: { acceptedCount: 1 },
      firstRevenue: { sourceState: "missing" },
    }),
    sourceStates: { traffic: "missing" },
  });

  assert.equal(card.type, "revenue_or_activation_gate");
  assert.equal(card.gate, GATE_IDS.G5);
  assert.equal(card.satisfied, false);
  assert.equal(card.sourceState, "missing");
  assert.ok(card.blockingReasons.includes("missing traffic source"));
  assert.equal(card.recoveryBranch, "g5-recovery-channel-reselect");
});

test("G6 revenue_or_activation_gate rejects missing scoreboard source state", async () => {
  const evaluation = evaluateProgramGates({ proofLedger: { events: [] }, currentDay: 29, now: T0 });
  const snapshot = scoreboardSnapshot(29);
  delete snapshot.scoreboards.firstRevenue.sourceState;

  assert.throws(
    () => buildRevenueOrActivationGateCard({
      gateId: GATE_IDS.G6,
      evaluation,
      scoreboardSnapshot: snapshot,
    }),
    /ERR_MISSING_SOURCE_STATE/,
  );
});

test("G6 paymentRecord missing keeps v2 revenue_or_activation_gate blocked", async () => {
  const proofLedger = {
    events: [
      { id: "a1", type: "payment_intent", day: 20, status: "accepted", strength: "strong" },
      { id: "a2", type: "payment_intent", day: 24, status: "accepted", strength: "strong" },
      { id: "a3", type: "payment_intent", day: 27, status: "accepted", strength: "strong" },
      { id: "r1", type: "payment_failure", day: 27, status: "accepted", strength: "strong", metadata: { kind: "refusal" } },
    ],
  };
  const evaluation = evaluateProgramGates({ proofLedger, currentDay: 29, now: T0 });
  assert.equal(evaluation.gates.G6.state, GATE_STATES.passed);

  const card = await buildRevenueOrActivationGateCard({
    gateId: GATE_IDS.G6,
    evaluation,
    proofLedger,
    scoreboardSnapshot: scoreboardSnapshot(29, {
      firstRevenue: { learningCounts: { paymentIntent: 3, paymentFailure: 1 } },
    }),
  });

  assert.equal(card.type, "revenue_or_activation_gate");
  assert.equal(card.gate, GATE_IDS.G6);
  assert.equal(card.satisfied, false);
  assert.equal(card.sourceState, "ready");
  assert.equal(card.scoreboard.firstRevenue.acceptedCount, 0);
  assert.ok(card.blockingReasons.includes("paymentRecord missing"));
  assert.equal(card.recoveryBranch, "g6-recovery-ask-and-refusal");
});

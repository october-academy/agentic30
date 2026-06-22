import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  GATE_IDS,
  GATE_LEDGER_SCHEMA_VERSION,
  GATE_STATES,
  applyGateEvaluation,
  countIssuedInterventionTokens,
  evaluateAndRecordProgramGates,
  evaluateProgramGates,
  issueGateInterventionToken,
  latestTrafficSignalFromProofs,
  loadGateLedger,
  recordGateAdaptiveEvent,
  recordMissionSubstitution,
  resolveBlockingGate,
  resolveDueSubstitutions,
  resolveGateLedgerPath,
} from "../sidecar/program-gate-engine.mjs";

const T0 = new Date("2026-06-12T09:00:00.000Z");

function strongInterview(day = 3) {
  return { id: `interview-${day}`, type: "interview", day, status: "verified", strength: "strong" };
}

function foundationClosedEvents() {
  // Supporting evidence is intentionally NOT payment_intent so that G4's
  // paid-ask condition stays independent of the foundation closure fixture
  // (a Day-6 paymentIntent would legitimately count toward G4①).
  return [
    { id: "supporting-1", type: "landing_metric", day: 6, status: "verified", strength: "medium", polarity: "supporting" },
    { id: "counter-1", type: "interview", day: 5, status: "verified", strength: "strong", polarity: "counter" },
    { id: "decision-1", type: "day_decision", day: 7, status: "accepted", decision: "continue" },
  ];
}

test("G1 stays open before Day 4 and hard-blocks Day 4 without strong interview evidence", () => {
  const early = evaluateProgramGates({
    proofLedger: { events: [] },
    currentDay: 2,
    now: T0,
  });
  assert.equal(early.gates.G1.state, GATE_STATES.open);
  assert.equal(early.blockingGate, null);

  const day4 = evaluateProgramGates({
    proofLedger: { events: [] },
    currentDay: 4,
    now: T0,
  });
  assert.equal(day4.gates.G1.state, GATE_STATES.blocked);
  assert.equal(day4.blockingGate.gateId, GATE_IDS.G1);
  assert.equal(day4.blockingGate.blockedStep, "goal");
  assert.deepEqual(day4.gates.G1.requiredEvidence.map((entry) => entry.id), [
    "interview_strong_evidence",
  ]);

  const mediumOnly = evaluateProgramGates({
    proofLedger: {
      events: [{ id: "i1", type: "interview", day: 2, status: "accepted", strength: "medium" }],
    },
    currentDay: 4,
    now: T0,
  });
  assert.equal(mediumOnly.gates.G1.state, GATE_STATES.blocked);

  const strong = evaluateProgramGates({
    proofLedger: { events: [strongInterview(2)] },
    currentDay: 4,
    now: T0,
  });
  assert.equal(strong.gates.G1.state, GATE_STATES.passed);
  assert.equal(strong.gates.G1.resolutionPath, "evidence");
});

test("G2 blocks Day 8 until closure + strong interview + day decision are all present", () => {
  const blocked = evaluateProgramGates({
    proofLedger: {
      events: [
        strongInterview(3),
        { id: "decision-1", type: "day_decision", day: 7, status: "accepted", decision: "continue" },
      ],
    },
    currentDay: 8,
    now: T0,
  });
  assert.equal(blocked.gates.G2.state, GATE_STATES.blocked);
  assert.equal(blocked.blockingGate.gateId, GATE_IDS.G2);
  assert.deepEqual(blocked.gates.G2.requiredEvidence.map((entry) => entry.id), [
    "foundation_closure_closed",
  ]);

  const open = evaluateProgramGates({
    proofLedger: { events: [] },
    currentDay: 7,
    now: T0,
  });
  assert.equal(open.gates.G2.state, GATE_STATES.open);

  const passed = evaluateProgramGates({
    proofLedger: { events: foundationClosedEvents() },
    currentDay: 8,
    now: T0,
  });
  assert.equal(passed.gates.G2.state, GATE_STATES.passed);
  assert.equal(passed.blockingGate, null);
});

test("G4 requires strong paid-ask evidence plus observed first_value", () => {
  const passed = evaluateProgramGates({
    proofLedger: {
      events: [
        ...foundationClosedEvents(),
        { id: "ask-1", type: "payment_intent", day: 14, status: "accepted", strength: "strong" },
      ],
    },
    currentDay: 15,
    firstValue: { observed: true, rowCount: 3 },
    sources: { posthogAvailable: true },
    now: T0,
  });
  assert.equal(passed.gates.G4.state, GATE_STATES.passed);

  const weakAsk = evaluateProgramGates({
    proofLedger: {
      events: [
        ...foundationClosedEvents(),
        { id: "ask-weak", type: "dm_ask", day: 14, status: "accepted", strength: "medium" },
      ],
    },
    currentDay: 15,
    firstValue: { observed: true },
    sources: { posthogAvailable: true },
    now: T0,
  });
  assert.equal(weakAsk.gates.G4.state, GATE_STATES.blocked);
  assert.equal(weakAsk.gates.G4.blockedReason, "paid_ask_strong_evidence");
  assert.equal(weakAsk.gates.G4.provisional, null);

  const zeroRows = evaluateProgramGates({
    proofLedger: {
      events: [
        ...foundationClosedEvents(),
        { id: "ask-1", type: "payment_intent", day: 14, status: "accepted", strength: "strong" },
      ],
    },
    currentDay: 15,
    firstValue: { observed: false, rowCount: 0 },
    sources: { posthogAvailable: true },
    now: T0,
  });
  assert.equal(zeroRows.gates.G4.state, GATE_STATES.blocked);
  assert.equal(zeroRows.gates.G4.blockedReason, "first_value_observed");
  assert.equal(zeroRows.gates.G4.provisional, null);
  assert.equal(zeroRows.blockingGate.gateId, GATE_IDS.G4);
});

test("G4 source outage grants a 3-day provisional overlay without passing the gate", () => {
  const events = [
    ...foundationClosedEvents(),
    { id: "ask-1", type: "payment_intent", day: 14, status: "accepted", strength: "strong" },
  ];
  const outage = evaluateProgramGates({
    proofLedger: { events },
    currentDay: 15,
    firstValue: null,
    sources: { posthogAvailable: false },
    now: T0,
  });
  assert.equal(outage.gates.G4.state, GATE_STATES.blocked);
  assert.equal(outage.gates.G4.blockedReason, "source_unavailable");
  assert.equal(outage.gates.G4.provisional.active, true);
  // Day progression is temporarily allowed, but the gate is NOT passed.
  assert.equal(outage.blockingGate, null);

  // Provisional never applies when an evidence condition is also unmet.
  const noAsk = evaluateProgramGates({
    proofLedger: { events: foundationClosedEvents() },
    currentDay: 15,
    firstValue: null,
    sources: { posthogAvailable: false },
    now: T0,
  });
  assert.equal(noAsk.gates.G4.provisional, null);
  assert.equal(noAsk.blockingGate.gateId, GATE_IDS.G4);

  // After 3 days the overlay lapses and the hard block returns.
  const ledger = applyGateEvaluation({}, outage, { now: T0 });
  const later = evaluateProgramGates({
    proofLedger: { events },
    currentDay: 19,
    firstValue: null,
    sources: { posthogAvailable: false },
    previousGates: ledger.gates,
    now: new Date("2026-06-16T10:00:00.000Z"),
  });
  assert.equal(later.gates.G4.provisional.active, false);
  assert.equal(later.blockingGate.gateId, GATE_IDS.G4);
});

test("intervention token passes a blocked gate once, expires at dueDay, and cannot be reissued", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-gate-token-"));
  const incompleteProofs = {
    events: [
      strongInterview(3),
      { id: "decision-1", type: "day_decision", day: 7, status: "accepted", decision: "continue" },
    ],
  };

  const blockedRun = await evaluateAndRecordProgramGates({
    workspaceRoot: root,
    proofLedger: incompleteProofs,
    currentDay: 8,
    now: T0,
  });
  assert.equal(blockedRun.evaluation.gates.G2.state, GATE_STATES.blocked);

  const issued = await issueGateInterventionToken({
    workspaceRoot: root,
    gateId: GATE_IDS.G2,
    dueDay: 9,
    expectedEvidenceKind: "url",
    now: T0,
  });
  assert.equal(issued.issued, true);
  assert.equal(issued.totalIssued, 1);

  const tokenPass = await evaluateAndRecordProgramGates({
    workspaceRoot: root,
    proofLedger: incompleteProofs,
    currentDay: 9,
    now: new Date("2026-06-13T09:00:00.000Z"),
  });
  assert.equal(tokenPass.evaluation.gates.G2.state, GATE_STATES.passed);
  assert.equal(tokenPass.evaluation.gates.G2.resolutionPath, "confession_token");

  const expired = await evaluateAndRecordProgramGates({
    workspaceRoot: root,
    proofLedger: incompleteProofs,
    currentDay: 10,
    now: new Date("2026-06-14T09:00:00.000Z"),
  });
  assert.equal(expired.evaluation.gates.G2.state, GATE_STATES.blocked);
  assert.equal(expired.evaluation.gates.G2.blockedReason, "intervention_token_expired");
  assert.deepEqual(expired.evaluation.expiredTokenGateIds, [GATE_IDS.G2]);
  assert.equal(expired.ledger.gates.G2.interventionToken.expired, true);

  const reissue = await issueGateInterventionToken({
    workspaceRoot: root,
    gateId: GATE_IDS.G2,
    dueDay: 12,
    now: new Date("2026-06-14T10:00:00.000Z"),
  });
  assert.equal(reissue.issued, false);
  assert.equal(reissue.reason, "token_already_issued");
  assert.equal(countIssuedInterventionTokens(reissue.ledger), 1);

  // Expired token stays expired even on re-evaluation; strong evidence is
  // now the only path (말만으로 gate를 반복 통과하는 체인 차단, §13.4).
  const still = await evaluateAndRecordProgramGates({
    workspaceRoot: root,
    proofLedger: incompleteProofs,
    currentDay: 11,
    now: new Date("2026-06-15T09:00:00.000Z"),
  });
  assert.equal(still.evaluation.gates.G2.state, GATE_STATES.blocked);

  const recovered = await evaluateAndRecordProgramGates({
    workspaceRoot: root,
    proofLedger: { events: foundationClosedEvents() },
    currentDay: 11,
    now: new Date("2026-06-15T10:00:00.000Z"),
  });
  assert.equal(recovered.evaluation.gates.G2.state, GATE_STATES.passed);
  assert.equal(recovered.evaluation.gates.G2.resolutionPath, "evidence");
});

test("intervention token does not pass a gate before its enforcement day", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-gate-token-active-day-"));
  const issued = await issueGateInterventionToken({
    workspaceRoot: root,
    gateId: GATE_IDS.G4,
    dueDay: 16,
    now: T0,
  });
  assert.equal(issued.issued, true);

  const beforeEnforce = await evaluateAndRecordProgramGates({
    workspaceRoot: root,
    proofLedger: { events: foundationClosedEvents() },
    currentDay: 14,
    firstValue: { observed: false, rowCount: 0 },
    sources: { posthogAvailable: true },
    now: T0,
  });
  assert.equal(beforeEnforce.evaluation.gates.G4.state, GATE_STATES.open);
  assert.equal(beforeEnforce.evaluation.gates.G4.resolutionPath, "");

  const invalid = await issueGateInterventionToken({
    workspaceRoot: await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-gate-token-too-early-")),
    gateId: GATE_IDS.G5,
    dueDay: 10,
    now: T0,
  });
  assert.equal(invalid.issued, false);
  assert.equal(invalid.reason, "token_before_gate_active");
});

test("gate ledger persists schema v1 with capped evaluation history and idempotent re-runs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-gate-ledger-"));
  const first = await evaluateAndRecordProgramGates({
    workspaceRoot: root,
    proofLedger: { events: [] },
    currentDay: 4,
    now: T0,
  });
  assert.equal(first.ledger.schemaVersion, GATE_LEDGER_SCHEMA_VERSION);
  assert.equal(first.ledger.schema, "agentic30.gate_ledger.v1");
  assert.equal(first.ledger.gates.G1.state, GATE_STATES.blocked);

  const rerun = await evaluateAndRecordProgramGates({
    workspaceRoot: root,
    proofLedger: { events: [] },
    currentDay: 4,
    now: new Date("2026-06-12T10:00:00.000Z"),
  });
  assert.equal(rerun.ledger.gates.G1.state, GATE_STATES.blocked);
  // `since` is preserved across same-state evaluations (idempotent re-eval).
  assert.equal(rerun.ledger.gates.G1.since, first.ledger.gates.G1.since);
  assert.equal(rerun.ledger.gates.G1.evaluations.length, 2);

  const loaded = await loadGateLedger({ workspaceRoot: root });
  assert.equal(loaded.gates.G1.state, GATE_STATES.blocked);
  assert.equal(
    resolveGateLedgerPath(root),
    path.join(root, ".agentic30", "gate-ledger.json"),
  );

  const adaptive = await recordGateAdaptiveEvent({
    workspaceRoot: root,
    event: { ruleId: "AR-01", signals: { buildWithoutCustomerEvidence: true } },
    now: T0,
  });
  assert.equal(adaptive.event.ruleId, "AR-01");
  assert.equal(adaptive.ledger.adaptiveEvents.length, 1);

  const substitution = await recordMissionSubstitution({
    workspaceRoot: root,
    substitution: {
      day: 15,
      failedGate: "G4",
      replacedMission: "Revenue Dry Run",
      replacementMissionId: "g4-recovery-ask-resend",
      exitCondition: "paymentIntent strong ≥1 + first_value ≥1행",
      reason: "G4_failed",
    },
    now: T0,
  });
  assert.equal(substitution.ledger.substitutions.length, 1);
  assert.equal(substitution.ledger.substitutions[0].failedGate, "G4");
});

test("resolveBlockingGate ignores warning-style gates and respects gate order", () => {
  const evaluation = evaluateProgramGates({
    proofLedger: { events: [] },
    currentDay: 15,
    firstValue: null,
    sources: {},
    now: T0,
  });
  // G1, G2, G4 all blocked at day 15 — the earliest gate wins.
  assert.equal(evaluation.blockingGate.gateId, GATE_IDS.G1);
  assert.equal(
    resolveBlockingGate({ gates: evaluation.gates, targetDay: 3 }),
    null,
  );
});

// --- P1-4: G5/G6/G7 evaluators + substitution table ---
test("G5 requires automated traffic plus an active user; outage grants provisional only", () => {
  const passed = evaluateProgramGates({
    proofLedger: {
      events: [{ id: "traffic-1", type: "traffic_snapshot", day: 20, status: "verified" }],
    },
    currentDay: 22,
    firstValue: { observed: true, rowCount: 1 },
    sources: { posthogAvailable: true, cloudflareAvailable: true },
    now: T0,
  });
  assert.equal(passed.gates.G5.state, GATE_STATES.passed);

  const liveTraffic = evaluateProgramGates({
    proofLedger: { events: [] },
    currentDay: 22,
    traffic: { observed: true },
    firstValue: { observed: true, rowCount: 2 },
    sources: { posthogAvailable: true, cloudflareAvailable: true },
    now: T0,
  });
  assert.equal(liveTraffic.gates.G5.state, GATE_STATES.passed);

  // Sources up but zero traffic → genuine block, no provisional.
  const zeroTraffic = evaluateProgramGates({
    proofLedger: { events: [] },
    currentDay: 22,
    traffic: { observed: false },
    firstValue: { observed: true, rowCount: 1 },
    sources: { posthogAvailable: true, cloudflareAvailable: true },
    now: T0,
  });
  assert.equal(zeroTraffic.gates.G5.state, GATE_STATES.blocked);
  assert.equal(zeroTraffic.gates.G5.provisional, null);

  // Both sources down → blocked(source_unavailable) + provisional overlay.
  const outage = evaluateProgramGates({
    proofLedger: { events: [] },
    currentDay: 22,
    traffic: null,
    firstValue: null,
    sources: { posthogAvailable: false, cloudflareAvailable: false },
    now: T0,
  });
  assert.equal(outage.gates.G5.state, GATE_STATES.blocked);
  assert.equal(outage.gates.G5.blockedReason, "source_unavailable");
  assert.equal(outage.gates.G5.provisional.active, true);

  // 미수집 ≠ 유입 0: a connected source with no traffic measurement yet is a
  // source gap (provisional), never a genuine zero reading.
  const uncollected = evaluateProgramGates({
    proofLedger: { events: [] },
    currentDay: 22,
    traffic: null,
    firstValue: { observed: true, rowCount: 1 },
    sources: { posthogAvailable: true, cloudflareAvailable: true },
    now: T0,
  });
  assert.equal(uncollected.gates.G5.state, GATE_STATES.blocked);
  assert.equal(uncollected.gates.G5.blockedReason, "source_unavailable");
  assert.equal(uncollected.gates.G5.provisional.active, true);
});

test("latestTrafficSignalFromProofs derives the G5① traffic input from completed traffic_snapshot proofs", () => {
  // No traffic proof → null (source gap, not a real zero).
  assert.equal(latestTrafficSignalFromProofs({ events: [] }), null);
  // A submitted-but-not-completed traffic proof does not signal traffic.
  assert.equal(
    latestTrafficSignalFromProofs({
      events: [{ id: "t0", type: "traffic_snapshot", status: "submitted", createdAt: "2026-06-20T00:00:00.000Z" }],
    }),
    null,
  );
  // A completed traffic_snapshot reads as observed traffic by default.
  assert.deepEqual(
    latestTrafficSignalFromProofs({
      events: [{ id: "t1", type: "traffic_snapshot", status: "verified", createdAt: "2026-06-20T00:00:00.000Z" }],
    }),
    { observed: true },
  );
  // The latest proof wins; an explicit observed:false reads as zero traffic.
  assert.deepEqual(
    latestTrafficSignalFromProofs({
      events: [
        { id: "t1", type: "traffic_snapshot", status: "verified", createdAt: "2026-06-20T00:00:00.000Z", metadata: { observed: true } },
        { id: "t2", type: "traffic_snapshot", status: "accepted", createdAt: "2026-06-21T00:00:00.000Z", metadata: { observed: false } },
      ],
    }),
    { observed: false },
  );

  // The derived signal feeds the gate exactly like a live traffic input would,
  // without altering the gate's threshold logic: traffic observed + active
  // user ≥1 → G5 passes.
  const evaluation = evaluateProgramGates({
    proofLedger: { events: [] },
    currentDay: 22,
    firstValue: { observed: true, rowCount: 3 },
    traffic: latestTrafficSignalFromProofs({
      events: [{ id: "t1", type: "traffic_snapshot", status: "verified", createdAt: "2026-06-20T00:00:00.000Z" }],
    }),
    sources: { posthogAvailable: true },
    now: T0,
  });
  assert.equal(evaluation.gates.G5.state, GATE_STATES.passed);
});

test("G5 honors an explicit zero-traffic proof instead of treating any completed traffic snapshot as positive", () => {
  const proofLedger = {
    events: [
      { id: "t1", type: "traffic_snapshot", status: "verified", createdAt: "2026-06-20T00:00:00.000Z", metadata: { observed: true } },
      { id: "t2", type: "traffic_snapshot", status: "accepted", createdAt: "2026-06-21T00:00:00.000Z", metadata: { observed: false } },
    ],
  };
  const evaluation = evaluateProgramGates({
    proofLedger,
    currentDay: 22,
    firstValue: { observed: true, rowCount: 1 },
    sources: { posthogAvailable: true, cloudflareAvailable: true },
    now: T0,
  });
  const trafficCondition = evaluation.gates.G5.conditions.find((condition) => condition.id === "traffic_observed");
  assert.equal(trafficCondition.satisfied, false);
  assert.equal(trafficCondition.sourceUnavailable, false);
  assert.equal(evaluation.gates.G5.state, GATE_STATES.blocked);
  assert.equal(evaluation.gates.G5.provisional, null);
});

test("G6 passes on a strong payment record or three strong asks plus a refusal — never hard-blocks", () => {
  const viaRecord = evaluateProgramGates({
    proofLedger: {
      events: [{ id: "rec-1", type: "payment_record", day: 27, status: "accepted", strength: "strong" }],
    },
    currentDay: 28,
    now: T0,
  });
  assert.equal(viaRecord.gates.G6.state, GATE_STATES.passed);

  const viaRefusal = evaluateProgramGates({
    proofLedger: {
      events: [
        { id: "a1", type: "payment_intent", day: 20, status: "accepted", strength: "strong" },
        { id: "a2", type: "payment_intent", day: 24, status: "accepted", strength: "strong" },
        { id: "a3", type: "payment_intent", day: 27, status: "accepted", strength: "strong" },
        { id: "r1", type: "payment_failure", day: 27, status: "accepted", strength: "strong", metadata: { kind: "refusal" } },
      ],
    },
    currentDay: 28,
    now: T0,
  });
  assert.equal(viaRefusal.gates.G6.state, GATE_STATES.passed);

  // Two asks + refusal: unmet, but warning-style — day entry is never blocked.
  const unmet = evaluateProgramGates({
    proofLedger: {
      events: [
        { id: "a1", type: "payment_intent", day: 20, status: "accepted", strength: "strong" },
        { id: "r1", type: "payment_failure", day: 27, status: "accepted", strength: "strong", metadata: { kind: "refusal" } },
      ],
    },
    currentDay: 29,
    now: T0,
  });
  assert.equal(unmet.gates.G6.state, GATE_STATES.open);
  assert.notEqual(resolveBlockingGate({ gates: unmet.gates, targetDay: 29 })?.gateId, GATE_IDS.G6);
});

test("G7 needs a Day 30 decision with at least three evidence refs", () => {
  const held = evaluateProgramGates({
    proofLedger: {
      events: [
        { id: "d30", type: "day_decision", day: 30, status: "accepted", decision: "continue", refs: ["proof-1", "proof-2"] },
      ],
    },
    currentDay: 30,
    now: T0,
  });
  assert.equal(held.gates.G7.state, GATE_STATES.open);

  const graduated = evaluateProgramGates({
    proofLedger: {
      events: [
        { id: "d30", type: "day_decision", day: 30, status: "accepted", decision: "continue", refs: ["proof-1", "proof-2", "proof-3"] },
      ],
    },
    currentDay: 30,
    now: T0,
  });
  assert.equal(graduated.gates.G7.state, GATE_STATES.passed);
});

test("substitution table records recovery missions once per failed gate", () => {
  const blockedG2 = evaluateProgramGates({
    proofLedger: { events: [] },
    currentDay: 8,
    now: T0,
  });
  const due = resolveDueSubstitutions({ evaluation: blockedG2, ledger: { substitutions: [] }, now: T0 });
  const g2Rows = due.filter((row) => row.failedGate === "G2");
  assert.deepEqual(g2Rows.map((row) => row.day), [8, 9]);
  assert.equal(g2Rows[0].reason, "G2_failed");
  assert.ok(g2Rows[0].exitCondition.includes("dayDecision"));

  // Idempotent: rows for a gate already in the ledger are not re-issued.
  const again = resolveDueSubstitutions({
    evaluation: blockedG2,
    ledger: { substitutions: [{ day: 8, failedGate: "G2", reason: "G2_failed" }] },
    now: T0,
  });
  assert.equal(again.filter((row) => row.failedGate === "G2").length, 0);

  // Warning-style G6: due once its objective day passed without a pass.
  const day29 = evaluateProgramGates({ proofLedger: { events: [] }, currentDay: 29, now: T0 });
  const g6Due = resolveDueSubstitutions({ evaluation: day29, ledger: { substitutions: [] }, now: T0 });
  assert.ok(g6Due.some((row) => row.failedGate === "G6" && row.day === 29));
  // G7 not due before its objective day passes.
  assert.equal(g6Due.some((row) => row.failedGate === "G7"), false);
});

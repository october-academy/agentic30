import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_HOURS_ARC_PERSONAS,
  DEFAULT_ARC_PLAN,
  G2_FOUNDATION_EVIDENCE,
  G4_PAID_ASK_EVIDENCE,
  G4_FIRST_VALUE_SNAPSHOT,
  DAY1_GET_USERS_LADDER_SIGNALS,
  selectStructuredResponse,
  summarizeArcRun,
  runOfficeHoursArcSimulation,
} from "../sidecar-evals/office-hours-arc-simulation.mjs";

// These tests pin the pure contract of the Day-arc simulation so the harness can
// be maintained without re-running a live provider. The sidecar-spawning runner
// is exercised by `npm run sim:office-hours[:live]`; one bounded stub smoke run
// is opt-in via AGENTIC30_RUN_ARC_STUB_SMOKE=1 to keep `npm run test:sidecar`
// fast and deterministic.

test("persona catalog exposes ICP and builder personas with ordered answers", () => {
  const ids = Object.keys(OFFICE_HOURS_ARC_PERSONAS);
  assert.ok(ids.includes("icp-solo-dev"));
  assert.ok(ids.includes("builder-side-project"));
  for (const persona of Object.values(OFFICE_HOURS_ARC_PERSONAS)) {
    assert.ok(persona.id && persona.label && persona.mode);
    assert.ok(Array.isArray(persona.answers) && persona.answers.length >= 3);
    assert.ok(persona.commitment && persona.commitment.customer && persona.commitment.expectedEvidenceKind);
  }
});

test("default plan spans the Day 8 G2 gate boundary", () => {
  const gateStep = DEFAULT_ARC_PLAN.find((s) => s.expectGateBlock);
  assert.equal(gateStep.day, 8);
  assert.equal(gateStep.expectGateBlock, "G2");
  assert.ok(DEFAULT_ARC_PLAN.some((s) => s.runOfficeHours && s.commit), "an office-hours + commit day exists");
});

test("default plan meaningfully covers the Day 1~30 arc with continuous early days", () => {
  // Day 1~7 must be a continuous office-hours + commit run (foundation phase),
  // not the old Day 1/2/8-only skeleton.
  for (let day = 1; day <= 7; day++) {
    const step = DEFAULT_ARC_PLAN.find((s) => s.day === day && s.runOfficeHours);
    assert.ok(step, `Day ${day} runs office-hours`);
    assert.equal(step.commit, true, `Day ${day} commits`);
  }
  // Plan reaches deep into the program (a late-program gate day).
  const maxDay = Math.max(...DEFAULT_ARC_PLAN.map((s) => s.day));
  assert.ok(maxDay >= 15, `plan reaches at least Day 15 (got ${maxDay})`);
});

test("default plan probes G2 block→pass and a follow-up gate via evidence submission", () => {
  // G2 must be probed as a block AND, after a submitEvidence step, as a pass.
  const g2Block = DEFAULT_ARC_PLAN.find((s) => s.expectGateBlock === "G2");
  const g2Pass = DEFAULT_ARC_PLAN.find((s) => s.expectGatePass === "G2");
  assert.ok(g2Block && g2Pass, "G2 is probed as both block and pass");
  assert.ok(
    DEFAULT_ARC_PLAN.indexOf(g2Block) < DEFAULT_ARC_PLAN.indexOf(g2Pass),
    "the G2 block probe precedes the G2 pass probe",
  );
  // A foundation-evidence submission step sits between the block and the pass.
  const g2Evidence = DEFAULT_ARC_PLAN.find((s) => Array.isArray(s.submitEvidence) && s.submitEvidence === G2_FOUNDATION_EVIDENCE);
  assert.ok(g2Evidence, "a G2 foundation-evidence submission step exists");
  assert.ok(
    DEFAULT_ARC_PLAN.indexOf(g2Block) < DEFAULT_ARC_PLAN.indexOf(g2Evidence)
      && DEFAULT_ARC_PLAN.indexOf(g2Evidence) < DEFAULT_ARC_PLAN.indexOf(g2Pass),
    "evidence is submitted between the G2 block and pass probes",
  );

  // At least one follow-up milestone gate (G4) is probed too, with its own evidence.
  const g4Block = DEFAULT_ARC_PLAN.find((s) => s.expectGateBlock === "G4");
  const g4Pass = DEFAULT_ARC_PLAN.find((s) => s.expectGatePass === "G4");
  assert.ok(g4Block && g4Block.day >= 15, "G4 block probe lands on Day 15+");
  assert.ok(g4Pass, "G4 is probed as a pass after evidence");
  const g4Evidence = DEFAULT_ARC_PLAN.find((s) => Array.isArray(s.submitEvidence) && s.submitEvidence === G4_PAID_ASK_EVIDENCE);
  assert.ok(g4Evidence && g4Evidence.firstValueSnapshot === G4_FIRST_VALUE_SNAPSHOT, "G4 evidence seeds a first_value snapshot");
});

test("G2 foundation evidence supplies all three gate conditions", () => {
  // foundation closure needs a completed Day 7 day_decision + strong supporting
  // + strong counter; G2 also needs interview strong. verified→strong inferred.
  const types = G2_FOUNDATION_EVIDENCE.map((e) => e.type);
  assert.ok(types.includes("interview"), "interview strong evidence present");
  assert.ok(types.includes("day_decision"), "Day 7 day_decision present");
  const decision = G2_FOUNDATION_EVIDENCE.find((e) => e.type === "day_decision");
  assert.equal(decision.day, 7);
  assert.ok(["continue", "pivot", "stop", "restart"].includes(decision.decision));
  assert.ok(G2_FOUNDATION_EVIDENCE.some((e) => e.polarity === "supporting"), "a supporting-polarity proof exists");
  assert.ok(G2_FOUNDATION_EVIDENCE.some((e) => e.polarity === "counter"), "a counter-polarity proof exists");
  for (const e of G2_FOUNDATION_EVIDENCE) {
    assert.equal(e.status, "verified", "evidence is verified (→ strength strong)");
  }
});

test("summarizeArcRun reports day coverage and gate block/pass history", () => {
  const day1Questions = DAY1_GET_USERS_LADDER_SIGNALS.map((signalId, turn) => ({ turn, signalId }));
  const summary = summarizeArcRun({
    days: [{ day: 1, questions: day1Questions }, { day: 7, questions: [] }],
    onboardingAnswered: 1,
    expectedGateBlock: "G4",
    gate: { gateBlocked: { gateId: "G4", requiredEvidence: [{ id: "paid_ask_strong_evidence" }] } },
    gateHistory: [
      { day: 8, kind: "block", expected: "G2", observed: "G2", ok: true },
      { day: 8, kind: "pass", expected: "G2", observedBlock: null, ok: true },
      { day: 15, kind: "block", expected: "G4", observed: "G4", ok: true },
      { day: 15, kind: "pass", expected: "G4", observedBlock: null, ok: true },
    ],
    evidenceSubmissions: [{}, {}],
    errors: [],
  });
  assert.deepEqual(summary.daysCovered, [1, 7, 8, 15]);
  assert.equal(summary.maxDayReached, 15);
  assert.deepEqual(summary.gatesBlocked, ["G2", "G4"]);
  assert.deepEqual(summary.gatesPassed, ["G2", "G4"]);
  assert.equal(summary.gateProbesPassed, true);
  assert.deepEqual(summary.day1GetUsersLadderSignals, DAY1_GET_USERS_LADDER_SIGNALS);
  assert.equal(summary.day1GetUsersLadderPassed, true);
  assert.equal(summary.evidenceSubmissions, 2);
  assert.equal(summary.passed, true);

  // A failed pass probe (gate still blocked) fails the run.
  const failedPass = summarizeArcRun({
    expectedGateBlock: null,
    gate: {},
    gateHistory: [{ day: 15, kind: "pass", expected: "G4", observedBlock: "G4", ok: false }],
    errors: [],
  });
  assert.equal(failedPass.gateProbesPassed, false);
  assert.equal(failedPass.passed, false);
});

test("selectStructuredResponse picks the honest no-evidence option for demand-evidence", () => {
  const persona = OFFICE_HOURS_ARC_PERSONAS["icp-solo-dev"];
  const resp = selectStructuredResponse({
    question: {
      signalId: "office_hours_demand_evidence",
      options: [
        { label: "실제 결제/계약이 있었다" },
        { label: "구매 조건이 구체적으로 확인됐다" },
        { label: "현재 대안에 돈/시간을 쓰고 있다" },
        { label: "관심만 있거나 아직 증거가 없다" },
      ],
    },
    persona,
    turnIndex: 1,
  });
  // ICP at N=0 must not inflate polite interest into a money signal.
  assert.deepEqual(resp.selectedOptions, ["관심만 있거나 아직 증거가 없다"]);
  assert.ok(resp.freeText.length > 0);
});

test("selectStructuredResponse falls back to persona free text for open questions", () => {
  const persona = OFFICE_HOURS_ARC_PERSONAS["icp-solo-dev"];
  const resp = selectStructuredResponse({ question: { signalId: "office_hours_specificity", options: [] }, persona, turnIndex: 2 });
  assert.deepEqual(resp.selectedOptions, []);
  assert.equal(resp.freeText, persona.answers[2]);
});

test("summarizeArcRun requires the expected gate id and zero errors to pass", () => {
  const day1Questions = DAY1_GET_USERS_LADDER_SIGNALS.map((signalId, turn) => ({ turn, signalId }));
  const pass = summarizeArcRun({
    days: [{ day: 1, questions: day1Questions }],
    onboardingAnswered: 1,
    expectedGateBlock: "G2",
    gate: { gateBlocked: { gateId: "G2", requiredEvidence: [{ id: "foundation_closure_closed" }] } },
    errors: [],
  });
  assert.equal(pass.gateBlockWorks, true);
  assert.equal(pass.day1GetUsersLadderPassed, true);
  assert.equal(pass.passed, true);
  assert.deepEqual(pass.gateRequiredEvidence, ["foundation_closure_closed"]);

  const wrongGate = summarizeArcRun({
    expectedGateBlock: "G2",
    gate: { gateBlocked: { gateId: "G4" } },
    errors: [],
  });
  assert.equal(wrongGate.gateBlockWorks, false);
  assert.equal(wrongGate.passed, false);

  const withErrors = summarizeArcRun({ expectedGateBlock: null, gate: {}, errors: ["boom"] });
  assert.equal(withErrors.passed, false);
});

// Opt-in stub smoke: spawns the real sidecar (stub provider) and asserts the
// provider-independent Day 8 / G2 gate authority end-to-end. Off by default so
// the unit suite stays fast; enable with AGENTIC30_RUN_ARC_STUB_SMOKE=1.
test("stub arc run blocks Day 8 entry at the G2 foundation gate", { skip: process.env.AGENTIC30_RUN_ARC_STUB_SMOKE !== "1" }, async () => {
  const { summary } = await runOfficeHoursArcSimulation({
    mode: "stub",
    personaId: "icp-solo-dev",
    plan: [{ day: 8, runOfficeHours: false, commit: false, expectGateBlock: "G2", commitStep: "scan" }],
  });
  assert.equal(summary.gateBlockObserved, "G2");
  assert.equal(summary.gateBlockWorks, true);
});

// Opt-in stub smoke for the full extended Day 1~30 arc: drives the default plan
// through the real sidecar (stub provider) and asserts (a) the early days run
// past Day 2, (b) G2 blocks then opens after evidence, and (c) a follow-up gate
// (G4 on Day 15) blocks then opens — the day-progress + gate mechanism really
// advancing across the arc, not the (sparse) stub forcing-question text.
test("stub arc run advances Day 1~15 across the G2 and G4 gate boundaries", { skip: process.env.AGENTIC30_RUN_ARC_STUB_SMOKE !== "1" }, async () => {
  const { summary, captured } = await runOfficeHoursArcSimulation({
    mode: "stub",
    personaId: "icp-solo-dev",
    plan: DEFAULT_ARC_PLAN,
  });
  // Day 3+ is actually recorded — the original Day 1/2-only ceiling is gone.
  assert.ok(captured.days.some((d) => d.day >= 3), "captured.json records Day 3 or later");
  assert.ok(summary.maxDayReached >= 15, `arc reaches Day 15+ (got ${summary.maxDayReached})`);
  assert.ok(summary.daysCovered.includes(8) && summary.daysCovered.includes(15), "covers the G2 and G4 gate days");
  // Both gates blocked without evidence and opened after the submitEvidence steps.
  assert.deepEqual(summary.gatesBlocked, ["G2", "G4"]);
  assert.deepEqual(summary.gatesPassed, ["G2", "G4"]);
  assert.equal(summary.gateProbesPassed, true);
  assert.equal(summary.passed, true);
  assert.deepEqual(summary.errors, []);
});

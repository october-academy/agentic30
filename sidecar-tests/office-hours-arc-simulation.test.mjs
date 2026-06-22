import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_HOURS_ARC_PERSONAS,
  DEFAULT_ARC_PLAN,
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
  const pass = summarizeArcRun({
    days: [{ day: 1, questions: [{ turn: 0 }] }],
    onboardingAnswered: 1,
    expectedGateBlock: "G2",
    gate: { gateBlocked: { gateId: "G2", requiredEvidence: [{ id: "foundation_closure_closed" }] } },
    errors: [],
  });
  assert.equal(pass.gateBlockWorks, true);
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

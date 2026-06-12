import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  INTERVENTION_GATE_IDS,
  OH_INTERVENTION_EVENT_TYPE,
  buildInterventionContextBlock,
  buildInterventionRequiredEvent,
  interventionTriggerForGate,
  issueInterventionTokenForCommitment,
} from "../sidecar/oh-intervention.mjs";
import {
  listInterventionTriggerIds,
  resolveInterventionPrompt,
} from "../sidecar/oh-intervention-prompts.mjs";
import {
  GATE_STATES,
  MAX_INTERVENTION_TOKENS,
  evaluateAndRecordProgramGates,
  issueGateInterventionToken,
} from "../sidecar/program-gate-engine.mjs";

const T0 = new Date("2026-06-12T09:00:00.000Z");

test("every registered trigger has authored questions and unknown triggers fail closed", () => {
  for (const triggerId of listInterventionTriggerIds()) {
    const pack = resolveInterventionPrompt(triggerId);
    assert.ok(pack.questions.length >= 1, `${triggerId} must author questions`);
    assert.ok(["immediate", "scheduled"].includes(pack.severity));
    assert.ok(pack.exitCondition.includes("커밋먼트"));
  }
  assert.equal(resolveInterventionPrompt("rule_AR99"), null);
  assert.equal(buildInterventionRequiredEvent({ triggerId: "rule_AR99" }), null);
  assert.equal(buildInterventionContextBlock("rule_AR99"), "");
});

test("milestone gate blocks map to registered triggers; G1 stays on the confession path", () => {
  assert.deepEqual([...INTERVENTION_GATE_IDS], ["G2", "G4", "G5", "G7"]);
  assert.equal(interventionTriggerForGate("G2"), "gate_blocked_G2");
  assert.equal(interventionTriggerForGate("G1"), null);
  assert.equal(interventionTriggerForGate("G3"), null);
  for (const gateId of INTERVENTION_GATE_IDS) {
    const event = buildInterventionRequiredEvent({
      workspaceRoot: "/tmp/product",
      triggerId: interventionTriggerForGate(gateId),
      day: 8,
    });
    assert.equal(event.type, OH_INTERVENTION_EVENT_TYPE);
    assert.equal(event.intervention.gateId, gateId);
    assert.equal(event.intervention.severity, "immediate");
    assert.ok(event.intervention.questions.length >= 2);
  }
});

test("intervention context block carries the §13.3 session contract", () => {
  const block = buildInterventionContextBlock("gate_blocked_G4");
  assert.match(block, /OFFICE HOURS INTERVENTION/);
  assert.match(block, /G4 milestone gate/);
  assert.match(block, /종료 조건: 구조화 커밋먼트 1개/);
  assert.match(block, /세션 후 의무/);

  const abbreviated = buildInterventionContextBlock("interview_confession", { abbreviated: true });
  assert.match(abbreviated, /interview_gate|intervention/);
});

test("commitment-confirmed token issuance uses the commitment dueDay and unlocks the gate", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-oh-token-"));
  const incompleteProofs = { events: [] };

  const blocked = await evaluateAndRecordProgramGates({
    workspaceRoot: root,
    proofLedger: incompleteProofs,
    currentDay: 8,
    now: T0,
  });
  assert.equal(blocked.evaluation.gates.G2.state, GATE_STATES.blocked);

  const issuance = await issueInterventionTokenForCommitment({
    workspaceRoot: root,
    gateId: "G2",
    commitment: { dueDay: 9, expectedEvidenceKind: "url" },
    day: 8,
    now: T0,
  });
  assert.equal(issuance.issued, true);
  assert.equal(issuance.token.dueDay, 9);
  assert.equal(issuance.token.expectedEvidenceKind, "url");

  const unlocked = await evaluateAndRecordProgramGates({
    workspaceRoot: root,
    proofLedger: incompleteProofs,
    currentDay: 8,
    now: T0,
  });
  assert.equal(unlocked.evaluation.gates.G2.state, GATE_STATES.passed);
  assert.equal(unlocked.evaluation.gates.G2.resolutionPath, "confession_token");
});

test("token issuance beyond the program-wide cap is refused as escalation_required", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-oh-cap-"));
  const gates = ["G2", "G4", "G5"];
  assert.equal(gates.length, MAX_INTERVENTION_TOKENS);
  for (const gateId of gates) {
    const result = await issueGateInterventionToken({
      workspaceRoot: root,
      gateId,
      dueDay: 10,
      now: T0,
    });
    assert.equal(result.issued, true, `${gateId} should issue`);
  }

  const fourth = await issueInterventionTokenForCommitment({
    workspaceRoot: root,
    gateId: "G7",
    commitment: { dueDay: 31 },
    day: 30,
    now: T0,
  });
  assert.equal(fourth.issued, false);
  assert.equal(fourth.reason, "escalation_required");
  assert.equal(fourth.totalIssued, MAX_INTERVENTION_TOKENS);
});

test("missing commitment dueDay defaults to the next day", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-oh-default-due-"));
  const issuance = await issueInterventionTokenForCommitment({
    workspaceRoot: root,
    gateId: "G4",
    commitment: null,
    day: 15,
    now: T0,
  });
  assert.equal(issuance.issued, true);
  assert.equal(issuance.token.dueDay, 16);
});

// Regression tests for the v2 daily-card Risk-Based Lens selection (spec §5.5,
// §11.2-11.5). The lens fields are additive: the structured payload contract is
// unchanged, and selectedLens/lensReason/workType survive the program-daily-card
// validator end-to-end. (The workpack's user-visible next action stays in the
// rendered `workpack.targetExternalAction`/`expectedProof` fields — no separate
// derived summary field, which the Mac UI never rendered.)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  appendCommitment,
  loadOfficeHoursMemory,
  resolveCommitmentWithoutEvidence,
} from "../sidecar/office-hours-memory.mjs";
import {
  buildProgramV2DailyCardContext,
  buildProgramV2DailyCardEvents,
} from "../sidecar/program-v2-cards.mjs";

const RUNTIME_NOW = new Date("2026-06-20T09:00:00.000Z");
const ENV = { AGENTIC30_ENABLE_PROGRAM_V2: "1" };

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "program-v2-prose-"));
}

function paidAskDraft({ name = "Candidate A", dueDay = 3 } = {}) {
  return {
    customer: name,
    candidateName: name,
    channel: "DM",
    message: `Ask ${name} for a paid pilot.`,
    actionKind: "offer_paid_ask",
    actionText: `Ask ${name} for a paid pilot.`,
    expectedEvidenceKind: "payment",
    dueDay,
    confirmedByUser: true,
  };
}

async function seedOpenCommitment(workspaceRoot, name = "Candidate A") {
  const result = await appendCommitment({
    workspaceRoot,
    text: `Ask ${name} for a paid pilot.`,
    cycle: 1,
    day: 1,
    originText: `I will ask ${name} for a paid pilot.`,
    commitment: paidAskDraft({ name, dueDay: 1 }),
    now: new Date("2026-06-18T09:00:00.000Z"),
  });
  return result.commitments.at(-1).id;
}

const VALID_LENSES = new Set([
  "service_planning",
  "technical_implementation",
  "ui_ux",
  "risk_tradeoff",
  "acquisition_channel",
]);

test("the workpack's rendered next-action fields survive the daily-card validator", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    await seedOpenCommitment(workspaceRoot);
    const events = await buildProgramV2DailyCardEvents({
      workspaceRoot,
      day: 3,
      env: ENV,
      now: RUNTIME_NOW,
    });
    const workpack = events.find((event) => event.missionCard?.type === "office_hours_agent_workpack");
    assert.ok(workpack, "workpack event emitted");
    // validateProgramDailyCard clones the card; the lens fields + the rendered
    // next-action fields (what Swift's ContentView actually displays) must persist.
    assert.equal(typeof workpack.missionCard.lensReason, "string");
    assert.ok(VALID_LENSES.has(workpack.missionCard.selectedLens));
    assert.ok(String(workpack.missionCard.workpack.targetExternalAction || "").length > 0);
    assert.ok(String(workpack.missionCard.workpack.expectedProof || "").length > 0);
    // No derived summary field the Mac UI never renders.
    assert.equal(workpack.missionCard.userVisibleSummary, undefined);

    const types = events.map((event) => event.missionCard?.type);
    assert.ok(types.includes("program_scoreboard_snapshot"));
    assert.ok(types.includes("revenue_or_activation_gate"));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("workpack lens defaults to service_planning / offer-paid-ask without a dominant risk", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    await seedOpenCommitment(workspaceRoot);
    const context = await buildProgramV2DailyCardContext({
      workspaceRoot,
      programDay: 3,
      env: ENV,
      now: RUNTIME_NOW,
    });
    const workpack = context.cards.find((card) => card.type === "office_hours_agent_workpack");
    assert.ok(workpack);
    // Single open commitment, no repeated self-report, no scoreboard source: the
    // revenue-stalled branch yields the safe paid-ask default.
    assert.equal(workpack.selectedLens, "service_planning");
    assert.equal(workpack.workpack.workType, "offer/paid ask");
    assert.ok(VALID_LENSES.has(workpack.selectedLens));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("repeated self-report selects the risk_tradeoff lens", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    // Resolve two prior commitments without evidence -> repeated self-report debt.
    for (let index = 0; index < 2; index += 1) {
      const result = await appendCommitment({
        workspaceRoot,
        text: `Ask Candidate ${index} for a paid pilot.`,
        cycle: 1,
        day: 1,
        originText: `I will ask Candidate ${index} for a paid pilot.`,
        commitment: paidAskDraft({ name: `Candidate ${index}`, dueDay: 1 }),
        now: new Date("2026-06-18T09:00:00.000Z"),
      });
      const id = result.commitments.at(-1).id;
      await resolveCommitmentWithoutEvidence({
        workspaceRoot,
        commitmentId: id,
        reason: "not_sent",
        note: "Did not send; deferring.",
        originText: "Did not send; deferring.",
        now: new Date("2026-06-19T09:00:00.000Z"),
      });
    }
    // One still-open commitment so a workpack is produced.
    await seedOpenCommitment(workspaceRoot, "Candidate Z");

    const memory = await loadOfficeHoursMemory({ workspaceRoot, now: RUNTIME_NOW });
    const resolvedCount = memory.commitments.filter((c) => c.status === "resolved_without_evidence").length;
    assert.ok(resolvedCount >= 2, `expected >=2 resolved-without-evidence, got ${resolvedCount}`);

    const context = await buildProgramV2DailyCardContext({
      workspaceRoot,
      programDay: 3,
      env: ENV,
      now: RUNTIME_NOW,
    });
    const workpack = context.cards.find((card) => card.type === "office_hours_agent_workpack");
    assert.ok(workpack);
    assert.equal(workpack.selectedLens, "risk_tradeoff");
    assert.equal(workpack.workpack.workType, "follow-up plan");
    assert.match(workpack.lensReason, /자기보고/);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

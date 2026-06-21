import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MISSION_CARD_EVENT_TYPE,
  buildOfficeHoursAgentWorkpackCard,
  buildOfficeHoursStateTransitionCard,
  buildProgramDailyCardEvent,
  buildProgramScoreboardSnapshotCard,
  buildRevenueOrActivationGateCard,
} from "../sidecar/mission-card.mjs";
import { appendCommitment, loadOfficeHoursMemory } from "../sidecar/office-hours-memory.mjs";
import { loadProofLedger } from "../sidecar/execution-os.mjs";
import { buildProgramV2DailyCardContext, buildProgramV2DailyCardEvents } from "../sidecar/program-v2-cards.mjs";
import { handleOfficeHoursDailyCardSubmit } from "../sidecar/program-v2-submit.mjs";

const WORKPACK_TARGET = "Send one paid ask DM with price, outcome, and deadline.";
const RUNTIME_NOW = new Date("2026-06-20T09:00:00.000Z");

function dailyBase(overrides = {}) {
  return {
    generation: { signalId: "daily_card", signalLabel: "Daily card" },
    schemaVersion: 1,
    programDay: 14,
    sourceState: "ready",
    requiresUserAction: true,
    proofLedgerMapping: { paymentRecord: "firstRevenue.acceptedProof" },
    ...overrides,
  };
}

function validWorkpack(overrides = {}) {
  return {
    id: "workpack_day_14_g4",
    workType: "offer/paid ask",
    targetExternalAction: WORKPACK_TARGET,
    expectedProof: "Sent screenshot, sent time, recipient identifier, and reply text.",
    notProof: ["AI draft", "self-report that it will be sent"],
    owner: "founder",
    deadline: "2026-06-20T18:00:00+09:00",
    ...overrides,
  };
}

function workpackCard(overrides = {}) {
  return dailyBase({
    type: "office_hours_agent_workpack",
    generation: {
      signalId: "office_hours_agent_workpack",
      signalLabel: "Office Hours agent workpack",
    },
    selectedLens: "service_planning",
    sourceCommitmentId: "commitment_1",
    workpack: validWorkpack(),
    proofLedgerMapping: {
      paymentIntent: "firstRevenue.learningSignal",
      paymentRecord: "firstRevenue.acceptedProof",
    },
    ...overrides,
  });
}

function gateCard(overrides = {}) {
  return dailyBase({
    type: "revenue_or_activation_gate",
    gate: "G4",
    requires: ["paymentRecord"],
    satisfied: false,
    blockingReasons: ["paymentRecord missing"],
    recoveryBranch: "g4-recovery-ask-resend",
    nextCardType: "office_hours_agent_workpack",
    ...overrides,
  });
}

function scoreboardCard(overrides = {}) {
  return dailyBase({
    type: "program_scoreboard_snapshot",
    requiresUserAction: false,
    scoreboards: {
      activeUsers100: {
        acceptedCount: 0,
        excludedCounts: { "self-report": 1 },
        sourceState: "ready",
        nextUnblockAction: "activation friction fix workpack",
      },
      firstRevenue: {
        acceptedCount: 0,
        sourceState: "manual_proof_required",
        nextUnblockAction: "offer/paid ask follow-up plan",
      },
    },
    ...overrides,
  });
}

test("v2 daily card accepts office_hours_agent_workpack", () => {
  assert.equal(typeof buildProgramDailyCardEvent, "function");

  const card = buildProgramDailyCardEvent({
    workspaceRoot: "/tmp/product",
    missionCard: workpackCard(),
  });

  assert.equal(card.type, MISSION_CARD_EVENT_TYPE);
  assert.equal(card.workspaceRoot, "/tmp/product");
  assert.equal(card.missionCard.type, "office_hours_agent_workpack");
  assert.equal(card.missionCard.workpack.targetExternalAction, WORKPACK_TARGET);
  assert.deepEqual(card.missionCard.workpack.notProof, ["AI draft", "self-report that it will be sent"]);
  assert.equal(card.missionCard.sourceState, "ready");
  assert.deepEqual(card.missionCard.proofLedgerMapping, {
    paymentIntent: "firstRevenue.learningSignal",
    paymentRecord: "firstRevenue.acceptedProof",
  });
});

test("ERR_MALFORMED_AGENT_WORKPACK", () => {
  assert.equal(typeof buildProgramDailyCardEvent, "function");

  assert.throws(
    () => buildProgramDailyCardEvent({
      missionCard: workpackCard({ workpack: validWorkpack({ targetExternalAction: "", notProof: [] }) }),
    }),
    (error) => error?.code === "ERR_MALFORMED_AGENT_WORKPACK",
  );
});

test("empty sourceCommitmentId actionable workpack fails validation", () => {
  assert.throws(
    () => buildProgramDailyCardEvent({
      missionCard: workpackCard({ sourceCommitmentId: "" }),
    }),
    (error) => error?.code === "ERR_MALFORMED_AGENT_WORKPACK",
  );
});

test("v2 daily card accepts all supported program card types", () => {
  const cards = [
    buildOfficeHoursStateTransitionCard({
      ...dailyBase(),
      type: "office_hours_state_transition",
      commitmentId: "commitment_1",
      candidateName: "Candidate A",
      actionText: "Request validation material.",
      repeatCountWithoutEvidence: 2,
      choices: [{ id: "attach_evidence", label: "Attach evidence" }],
      resolutionReasons: ["not_sent"],
      proofLedgerMapping: {
        self_report: "officeHoursResolution.negativeEvidenceOnly",
        customer_screenshot: "customerEvidence.acceptedProof",
      },
    }),
    buildOfficeHoursAgentWorkpackCard(workpackCard()),
    buildProgramScoreboardSnapshotCard({
      ...scoreboardCard(),
      scoreboards: {
        activeUsers100: {
          acceptedCount: 7,
          excludedCounts: { signup: 42, visitor: 1380, "self-report": 3 },
          sourceState: "ready",
          nextUnblockAction: "activation friction fix workpack",
        },
        firstRevenue: {
          acceptedCount: 0,
          sourceState: "manual_proof_required",
          nextUnblockAction: "offer/paid ask follow-up plan",
        },
      },
      proofLedgerMapping: {
        first_value: "activeUsers100.acceptedProof",
        paymentRecord: "firstRevenue.acceptedProof",
      },
    }),
    buildRevenueOrActivationGateCard({
      ...gateCard(),
      requires: ["first_value", "paymentIntent"],
      blockingReasons: ["missing first_value source"],
      recoveryBranch: "g4-recovery-instrumentation",
      proofLedgerMapping: {
        first_value: "activeUsers100.acceptedProof",
        paymentIntent: "firstRevenue.learningSignal",
      },
    }),
  ];

  assert.deepEqual(cards.map((card) => card.type), [
    "office_hours_state_transition",
    "office_hours_agent_workpack",
    "program_scoreboard_snapshot",
    "revenue_or_activation_gate",
  ]);
});

test("ERR_MISSING_SOURCE_STATE", () => {
  assert.throws(
    () => buildProgramDailyCardEvent({
      missionCard: gateCard({ sourceState: undefined }),
    }),
    (error) => error?.code === "ERR_MISSING_SOURCE_STATE",
  );
});

test("ERR_UNKNOWN_CARD_TYPE", () => {
  assert.throws(
    () => buildProgramDailyCardEvent({
      missionCard: dailyBase({
        type: "program_magic_card",
      }),
    }),
    (error) => error?.code === "ERR_UNKNOWN_CARD_TYPE",
  );
});

test("ERR_INVALID_PROOF_MAPPING", () => {
  assert.throws(
    () => buildProgramDailyCardEvent({
      missionCard: gateCard({
        proofLedgerMapping: {
          paymentIntent: "firstRevenue.acceptedProof",
        },
      }),
    }),
    (error) => error?.code === "ERR_INVALID_PROOF_MAPPING",
  );
});

test("ERR_SELF_REPORT_COUNTED_AS_PROOF", () => {
  assert.throws(
    () => buildProgramDailyCardEvent({
      missionCard: scoreboardCard({
        proofLedgerMapping: {
          self_report: "firstRevenue.acceptedProof",
        },
      }),
    }),
    (error) => error?.code === "ERR_SELF_REPORT_COUNTED_AS_PROOF",
  );
});

test("office_hours_daily_card_submit rejects note-only payment proof without mutation", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    const seeded = await seedRepeatedOpenCommitments(workspaceRoot);
    const context = await buildProgramV2DailyCardContext({
      workspaceRoot,
      programDay: 3,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
    });
    const stateCard = context.cards.find((card) => card.type === "office_hours_state_transition");

    await assert.rejects(
      () => handleOfficeHoursDailyCardSubmit({
        workspaceRoot,
        env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
        now: RUNTIME_NOW,
        payload: {
          cardId: stateCard.id,
          cardGenerationId: stateCard.generation.generationId,
          sourceStateVersion: stateCard.sourceStateVersion,
          sourceCommitmentId: seeded.activeCommitmentId,
          action: "attach_evidence",
          evidenceRefs: [{ kind: "payment", note: "Customer says they paid." }],
          day: 3,
        },
      }),
      (error) => error?.code === "ERR_SELF_REPORT_COUNTED_AS_PROOF",
    );

    const memory = await loadOfficeHoursMemory({ workspaceRoot, now: RUNTIME_NOW });
    assert.equal(memory.commitments.find((item) => item.id === seeded.activeCommitmentId)?.status, "open");
    const ledger = await loadProofLedger({ workspaceRoot });
    assert.equal(ledger.events.length, 0);
    await assert.rejects(
      fs.stat(path.join(workspaceRoot, ".agentic30", "program-v2-daily-card-submissions.json")),
      /ENOENT/,
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("office_hours_daily_card_submit rejects legacy action ids", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    const seeded = await seedRepeatedOpenCommitments(workspaceRoot);
    const context = await buildProgramV2DailyCardContext({
      workspaceRoot,
      programDay: 3,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
    });
    const stateCard = context.cards.find((card) => card.type === "office_hours_state_transition");
    const basePayload = {
      cardId: stateCard.id,
      cardGenerationId: stateCard.generation.generationId,
      sourceStateVersion: stateCard.sourceStateVersion,
      sourceCommitmentId: seeded.activeCommitmentId,
      day: 3,
      evidenceRefs: [{ kind: "url", url: "https://example.com/customer-proof" }],
    };

    await assert.rejects(
      () => handleOfficeHoursDailyCardSubmit({
        workspaceRoot,
        env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
        now: RUNTIME_NOW,
        payload: { ...basePayload, action: "hard_evidence", choiceId: "hard_evidence" },
      }),
      (error) => error?.code === "ERR_MALFORMED_DAILY_CARD_SUBMISSION"
        && /hard_evidence/.test(error.message),
    );

    await assert.rejects(
      () => handleOfficeHoursDailyCardSubmit({
        workspaceRoot,
        env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
        now: RUNTIME_NOW,
        payload: { ...basePayload, action: "attach_evidence", choiceId: "hard_evidence" },
      }),
      (error) => error?.code === "ERR_MALFORMED_DAILY_CARD_SUBMISSION"
        && /choiceId must match action/.test(error.message),
    );

    const memory = await loadOfficeHoursMemory({ workspaceRoot, now: RUNTIME_NOW });
    assert.equal(memory.commitments.find((item) => item.id === seeded.activeCommitmentId)?.status, "open");
    const ledger = await loadProofLedger({ workspaceRoot });
    assert.equal(ledger.events.length, 0);
    await assert.rejects(
      fs.stat(path.join(workspaceRoot, ".agentic30", "program-v2-daily-card-submissions.json")),
      /ENOENT/,
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("keep_open_today does not block later attach_evidence", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    const seeded = await seedRepeatedOpenCommitments(workspaceRoot);
    const firstContext = await buildProgramV2DailyCardContext({
      workspaceRoot,
      programDay: 3,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
    });
    const stateCard = firstContext.cards.find((card) => card.type === "office_hours_state_transition");
    const basePayload = {
      cardId: stateCard.id,
      cardGenerationId: stateCard.generation.generationId,
      sourceStateVersion: stateCard.sourceStateVersion,
      sourceCommitmentId: seeded.activeCommitmentId,
      day: 3,
    };

    const keepOpen = await handleOfficeHoursDailyCardSubmit({
      workspaceRoot,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
      payload: { ...basePayload, action: "keep_open_today" },
    });
    assert.equal(keepOpen.action, "keep_open_today");

    await assert.rejects(
      fs.stat(path.join(workspaceRoot, ".agentic30", "program-v2-daily-card-submissions.json")),
      /ENOENT/,
    );

    const attached = await handleOfficeHoursDailyCardSubmit({
      workspaceRoot,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
      payload: {
        ...basePayload,
        action: "attach_evidence",
        evidenceRefs: [{ kind: "url", url: "https://example.com/customer-proof" }],
      },
    });
    assert.equal(attached.action, "attach_evidence");
    assert.equal(typeof attached.proofEventId, "string");

    const ledger = await loadProofLedger({ workspaceRoot });
    assert.equal(ledger.events.filter((event) => event.sourceUrl === "https://example.com/customer-proof").length, 1);
    const receipts = JSON.parse(await fs.readFile(
      path.join(workspaceRoot, ".agentic30", "program-v2-daily-card-submissions.json"),
      "utf8",
    ));
    assert.equal(receipts.submissions.length, 1);
    assert.equal(receipts.submissions[0].action, "attach_evidence");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("post-resolution workpack binds replacement commitment", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    const seeded = await seedRepeatedOpenCommitments(workspaceRoot);
    const context = await buildProgramV2DailyCardContext({
      workspaceRoot,
      programDay: 3,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
    });
    const stateCard = context.cards.find((card) => card.type === "office_hours_state_transition");

    const result = await handleOfficeHoursDailyCardSubmit({
      workspaceRoot,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
      payload: {
        cardId: stateCard.id,
        cardGenerationId: stateCard.generation.generationId,
        sourceStateVersion: stateCard.sourceStateVersion,
        sourceCommitmentId: seeded.activeCommitmentId,
        action: "replace_candidate",
        resolutionReason: "replaced_by_next_candidate",
        note: "Candidate A is not reachable; ask Candidate B today.",
        originText: "Candidate A is not reachable; ask Candidate B today.",
        replacementCandidate: {
          text: "Ask Candidate B for a presale deposit.",
          customer: "Candidate B",
          candidateName: "Candidate B",
          channel: "DM",
          message: "Ask Candidate B for a presale deposit.",
          actionKind: "offer_paid_ask",
          actionText: "Ask Candidate B for a presale deposit.",
          expectedEvidenceKind: "payment",
          dueDay: 3,
          confirmedByUser: true,
        },
        day: 3,
      },
    });
    assert.equal(typeof result.replacementCommitmentId, "string");

    const postContextA = await buildProgramV2DailyCardContext({
      workspaceRoot,
      programDay: 3,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
    });
    const postContextB = await buildProgramV2DailyCardContext({
      workspaceRoot,
      programDay: 3,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: new Date("2026-06-20T09:05:00.000Z"),
    });
    const workpackA = postContextA.cards.find((card) => card.type === "office_hours_agent_workpack");
    const workpackB = postContextB.cards.find((card) => card.type === "office_hours_agent_workpack");

    assert.equal(workpackA.sourceCommitmentId, result.replacementCommitmentId);
    assert.equal(workpackA.workpack.targetExternalAction, "Ask Candidate B for a presale deposit.");
    assert.equal(workpackA.workpack.expectedProof, "payment");
    assert.equal(workpackA.id, workpackB.id);
    assert.equal(workpackA.generation.generationId, workpackB.generation.generationId);
    assert.equal(workpackA.sourceStateVersion, workpackB.sourceStateVersion);
    assert.equal(workpackA.workpack.deadline, workpackB.workpack.deadline);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("no open commitment workpack is not emitted with empty sourceCommitmentId", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    const context = await buildProgramV2DailyCardContext({
      workspaceRoot,
      programDay: 3,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
    });
    const workpack = context.cards.find((card) => card.type === "office_hours_agent_workpack");
    assert.equal(workpack, undefined);
    assert.ok(context.cards.some((card) => card.type === "program_scoreboard_snapshot" && card.sourceState !== "ready"));
    assert.ok(context.cards.some((card) => card.type === "revenue_or_activation_gate" && card.sourceState !== "ready"));

    const events = await buildProgramV2DailyCardEvents({
      workspaceRoot,
      day: 3,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
    });
    const emittedWorkpack = events.find((event) => event.missionCard?.type === "office_hours_agent_workpack");
    assert.equal(emittedWorkpack, undefined);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("empty sourceCommitmentId invalid source commitment fields workpack is not emitted", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    await appendCommitment({
      workspaceRoot,
      text: "Ask Candidate C for a paid pilot.",
      cycle: 1,
      day: 3,
      originText: "I will ask Candidate C for a paid pilot.",
      now: RUNTIME_NOW,
    });

    const context = await buildProgramV2DailyCardContext({
      workspaceRoot,
      programDay: 3,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
    });
    const workpack = context.cards.find((card) => card.type === "office_hours_agent_workpack");
    assert.equal(workpack, undefined);

    const events = await buildProgramV2DailyCardEvents({
      workspaceRoot,
      day: 3,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
    });
    const emittedWorkpack = events.find((event) => event.missionCard?.type === "office_hours_agent_workpack");
    assert.equal(emittedWorkpack, undefined);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("program v2 runtime maps day 14/21/28/30 to G4/G5/G6/G7", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    const observed = [];
    for (const day of [14, 21, 28, 30]) {
      const context = await buildProgramV2DailyCardContext({
        workspaceRoot,
        programDay: day,
        env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
        now: RUNTIME_NOW,
      });
      observed.push(context.cards.find((card) => card.type === "revenue_or_activation_gate")?.gate);
    }
    assert.deepEqual(observed, ["G4", "G5", "G6", "G7"]);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("resolve without evidence rejects empty note", async () => {
  const workspaceRoot = await tempWorkspace();
  try {
    const seeded = await seedRepeatedOpenCommitments(workspaceRoot);
    const context = await buildProgramV2DailyCardContext({
      workspaceRoot,
      programDay: 3,
      env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
      now: RUNTIME_NOW,
    });
    const stateCard = context.cards.find((card) => card.type === "office_hours_state_transition");

    await assert.rejects(
      () => handleOfficeHoursDailyCardSubmit({
        workspaceRoot,
        env: { AGENTIC30_ENABLE_PROGRAM_V2: "1" },
        now: RUNTIME_NOW,
        payload: {
          cardId: stateCard.id,
          cardGenerationId: stateCard.generation.generationId,
          sourceStateVersion: stateCard.sourceStateVersion,
          sourceCommitmentId: seeded.activeCommitmentId,
          action: "resolve_without_evidence",
          resolutionReason: "not_sent",
          note: "",
          originText: "I did not send it.",
          day: 3,
        },
      }),
      (error) => error?.code === "ERR_RESOLUTION_NOTE_REQUIRED",
    );

    const memory = await loadOfficeHoursMemory({ workspaceRoot, now: RUNTIME_NOW });
    assert.equal(memory.commitments.find((item) => item.id === seeded.activeCommitmentId)?.status, "open");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "program-daily-card-"));
}

async function seedRepeatedOpenCommitments(workspaceRoot) {
  const first = await appendCommitment({
    workspaceRoot,
    text: "Ask Candidate A for a paid pilot.",
    cycle: 1,
    day: 1,
    originText: "I will ask Candidate A for a paid pilot.",
    commitment: repeatedCommitmentDraft({ dueDay: 1 }),
    now: new Date("2026-06-18T09:00:00.000Z"),
  });
  const firstId = first.commitments.at(-1).id;
  await appendCommitment({
    workspaceRoot,
    text: "Ask Candidate A for a paid pilot.",
    cycle: 2,
    day: 2,
    originText: "I will ask Candidate A for a paid pilot again.",
    commitment: repeatedCommitmentDraft({ dueDay: 2 }),
    now: new Date("2026-06-19T09:00:00.000Z"),
  });
  const memory = await loadOfficeHoursMemory({ workspaceRoot, now: RUNTIME_NOW });
  return {
    firstCommitmentId: firstId,
    activeCommitmentId: memory.commitments.at(-1).id,
  };
}

function repeatedCommitmentDraft({ dueDay }) {
  return {
    customer: "Candidate A",
    candidateName: "Candidate A",
    channel: "DM",
    message: "Ask Candidate A for a paid pilot.",
    actionKind: "offer_paid_ask",
    actionText: "Ask Candidate A for a paid pilot.",
    expectedEvidenceKind: "payment",
    dueDay,
    confirmedByUser: true,
  };
}

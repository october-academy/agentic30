import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  OFFICE_HOURS_MEMORY_SCHEMA,
  appendCommitment,
  buildEvidenceOS,
  classifyStaleCommitments,
  loadOfficeHoursMemory,
  makeDefaultOfficeHoursMemory,
  normalizeOfficeHoursMemory,
  resolveCommitmentWithoutEvidence,
} from "../sidecar/office-hours-memory.mjs";

const NOW = new Date("2026-06-08T09:00:00.000Z");

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "oh-mem-resolution-"));
}

function commitment(overrides = {}) {
  return {
    id: "cm-a",
    cycle: 1,
    createdDay: 1,
    createdAt: NOW.toISOString(),
    text: "Ask candidate A for validation proof",
    status: "open",
    evidence: null,
    origin: "user",
    customer: "Candidate A",
    channel: "DM",
    message: "Ask for validation proof",
    expectedEvidenceKind: "screenshot",
    dueDay: 1,
    confirmedByUser: true,
    candidateName: "Candidate A",
    actionKind: "request_validation_material",
    actionText: "Ask for validation proof",
    repeatCountWithoutEvidence: 0,
    ...overrides,
  };
}

async function appendSourceCommitment(ws) {
  const saved = await appendCommitment({
    workspaceRoot: ws,
    text: "Ask candidate A for validation proof",
    cycle: 1,
    day: 1,
    originText: "I will ask candidate A for validation proof",
    commitment: {
      customer: "Candidate A",
      candidateName: "Candidate A",
      actionKind: "request_validation_material",
      actionText: "Ask for validation proof",
      expectedEvidenceKind: "screenshot",
      dueDay: 1,
      confirmedByUser: true,
    },
    now: NOW,
  });
  return saved.commitments[0].id;
}

test("v3 memory loads non-destructively with resolution null", () => {
  const norm = normalizeOfficeHoursMemory({
    schemaVersion: 3,
    schema: OFFICE_HOURS_MEMORY_SCHEMA,
    updatedAt: NOW.toISOString(),
    commitments: [
      commitment({ id: "cm-v3", cycle: 1, createdDay: 1 }),
      commitment({ id: "cm-v3-repeat", cycle: 2, createdDay: 2 }),
    ],
  }, { now: NOW });

  assert.equal(norm.schemaVersion, 4);
  assert.deepEqual(norm.commitments.map((item) => item.resolution), [null, null]);
  assert.equal(classifyStaleCommitments(norm, { currentDay: 3 })[0].commitmentId, "cm-v3-repeat");
});

test("stale commitment after two repeats surfaces active debt candidate", () => {
  const memory = makeDefaultOfficeHoursMemory({ now: NOW });
  memory.commitments = [
    commitment({ id: "cm-repeat-1", status: "missed", createdAt: "2026-06-08T09:00:00.000Z" }),
    commitment({ id: "cm-repeat-2", cycle: 2, createdDay: 2, dueDay: 3, createdAt: "2026-06-09T09:00:00.000Z" }),
  ];

  const [candidate] = classifyStaleCommitments(normalizeOfficeHoursMemory(memory, { now: NOW }), { currentDay: 3 });
  assert.equal(candidate.commitmentId, "cm-repeat-2");
  assert.equal(candidate.repeatCountWithoutEvidence, 2);
  assert.equal(candidate.activeDebt, true);
  assert.equal(candidate.risks.includes("candidateNameMissing"), false);
});

test("resolved_without_evidence excludes active debt but preserves history metadata", () => {
  const memory = makeDefaultOfficeHoursMemory({ now: NOW });
  memory.commitments = [commitment({
    id: "cm-resolved",
    status: "resolved_without_evidence",
    repeatCountWithoutEvidence: 2,
    resolution: {
      reason: "not_sent",
      source: "self_report",
      note: "not sent",
      resolvedAt: NOW.toISOString(),
      countsAsCustomerEvidence: false,
    },
  })];
  const norm = normalizeOfficeHoursMemory(memory, { now: NOW });
  const evidenceOS = evidenceOSFor(norm);

  assert.equal(evidenceOS.openDebts.length, 0);
  assert.equal(evidenceOS.provenEvidence.length, 0);
  assert.equal(norm.commitments[0].resolution.reason, "not_sent");
  assert.equal(norm.commitments[0].resolution.countsAsCustomerEvidence, false);
});

test("replace candidate creates replacement commitment synchronously", async () => {
  const ws = await tempWorkspace();
  const sourceId = await appendSourceCommitment(ws);
  const result = await resolveCommitmentWithoutEvidence({
    workspaceRoot: ws,
    commitmentId: sourceId,
    reason: "replaced_by_next_candidate",
    note: "replace A with B",
    originText: "I will ask candidate B",
    nextCommitment: {
      text: "Ask candidate B for willingness to pay",
      customer: "Candidate B",
      candidateName: "Candidate B",
      channel: "DM",
      message: "Ask willingness to pay",
      actionKind: "offer_paid_ask",
      actionText: "Ask willingness to pay",
      expectedEvidenceKind: "screenshot",
      dueDay: 2,
      confirmedByUser: true,
    },
    cycle: 2,
    day: 2,
    now: new Date("2026-06-09T09:00:00.000Z"),
  });

  const resolved = result.memory.commitments.find((item) => item.id === sourceId);
  assert.equal(resolved.status, "resolved_without_evidence");
  assert.equal(resolved.resolution.reason, "replaced_by_next_candidate");
  assert.equal(result.replacement.origin, "user");
  assert.equal(result.replacement.status, "open");
  assert.equal(result.replacement.candidateName, "Candidate B");
  assert.deepEqual(evidenceOSFor(result.memory).openDebts.map((debt) => debt.id), [result.replacement.id]);
  await fs.rm(ws, { recursive: true, force: true });
});

test("replace candidate missing candidateName fails explicitly without persisting replacement", async () => {
  const ws = await tempWorkspace();
  const commitmentId = await appendSourceCommitment(ws);

  await assert.rejects(
    () => resolveCommitmentWithoutEvidence({
      workspaceRoot: ws,
      commitmentId,
      reason: "replaced_by_next_candidate",
      originText: "I will switch candidates",
      nextCommitment: {
        text: "Ask the next candidate",
        actionKind: "offer_paid_ask",
        actionText: "Ask willingness to pay",
        expectedEvidenceKind: "screenshot",
        dueDay: 2,
        confirmedByUser: true,
      },
      cycle: 2,
      day: 2,
      now: new Date("2026-06-09T09:00:00.000Z"),
    }),
    (error) => error?.code === "ERR_REPLACE_CANDIDATE_MISSING_NEXT_COMMITMENT",
  );

  const loaded = await loadOfficeHoursMemory({ workspaceRoot: ws, now: NOW });
  assert.equal(loaded.commitments.length, 1);
  assert.equal(loaded.commitments[0].status, "open");
  await fs.rm(ws, { recursive: true, force: true });
});

test("invalid resolution reason and replace candidate missing next commitment fail explicitly", async () => {
  const ws = await tempWorkspace();
  const commitmentId = await appendSourceCommitment(ws);
  await assert.rejects(
    () => resolveCommitmentWithoutEvidence({ workspaceRoot: ws, commitmentId, reason: "maybe_later", originText: "not sent", now: NOW }),
    (error) => error?.code === "ERR_INVALID_RESOLUTION_REASON",
  );
  await assert.rejects(
    () => resolveCommitmentWithoutEvidence({ workspaceRoot: ws, commitmentId, reason: "replaced_by_next_candidate", originText: "switch", now: NOW }),
    (error) => error?.code === "ERR_REPLACE_CANDIDATE_MISSING_NEXT_COMMITMENT",
  );
  await fs.rm(ws, { recursive: true, force: true });
});

test("self-report resolution creates no proof ledger event and no customer evidence", async () => {
  const ws = await tempWorkspace();
  const result = await resolveCommitmentWithoutEvidence({
    workspaceRoot: ws,
    commitmentId: await appendSourceCommitment(ws),
    reason: "not_sent",
    note: "not sent",
    originText: "I did not send it",
    now: new Date("2026-06-09T09:00:00.000Z"),
  });

  assert.equal(Object.hasOwn(result, "proofLedgerEvent"), false);
  assert.equal(result.commitment.status, "resolved_without_evidence");
  assert.equal(result.commitment.resolution.source, "self_report");
  assert.deepEqual(evidenceOSFor(result.memory).provenEvidence, []);
  await fs.rm(ws, { recursive: true, force: true });
});

function evidenceOSFor(memory) {
  return buildEvidenceOS({
    dayProgress: { challengeStartedAt: "2026-06-08", days: { "1": { day: 1, steps: { interview: "done" } } } },
    memory,
    workHistory: { generatedAt: NOW.toISOString(), days: [] },
    currentDay: 2,
  });
}

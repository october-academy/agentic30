import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { appendProofLedgerEvent, loadProofLedger } from "../sidecar/execution-os.mjs";

async function buildProgramScoreboardSnapshot(input) {
  const mod = await import("../sidecar/program-scoreboard.mjs");
  return mod.buildProgramScoreboardSnapshot(input);
}

test("activeUsers100 accepts only first_value", async () => {
  const snapshot = await buildProgramScoreboardSnapshot({
    programDay: 21,
    activeUsers: {
      sourceState: "ready",
      snapshots: [
        {
          at: "2026-06-12T09:00:00.000Z",
          activeUserCount: 7,
          firstValueEventName: "first_value",
          source: "posthog_hogql",
        },
        {
          at: "2026-06-13T09:00:00.000Z",
          activeUserCount: 999,
          firstValueEventName: "signup",
          source: "posthog_hogql",
        },
        {
          at: "2026-06-14T09:00:00.000Z",
          activeUserCount: 100,
          firstValueEventName: "signup",
          source: "core_activation_snapshot",
        },
      ],
      excludedCounts: {
        signup: 42,
        visitor: 1380,
        waitlist: 12,
        screenshot: 4,
        aiDemo: 3,
      },
    },
    proofLedger: {
      events: [
        { id: "self-report-1", type: "self_report", status: "accepted" },
        { id: "payment-intent-1", type: "payment_intent", status: "accepted" },
      ],
    },
  });

  assert.equal(snapshot.type, "program_scoreboard_snapshot");
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.programDay, 21);
  assert.equal(snapshot.scoreboards.activeUsers100.acceptedCount, 7);
  assert.deepEqual(snapshot.scoreboards.activeUsers100.excludedCounts, {
    signup: 42,
    visitor: 1380,
    waitlist: 12,
    screenshot: 4,
    aiDemo: 3,
    "self-report": 1,
  });
  assert.equal(snapshot.scoreboards.activeUsers100.sourceState, "ready");
  assert.equal(snapshot.scoreboards.activeUsers100.passing, false);
});

test("activeUsers100 rejects core activation snapshots without first_value proof", async () => {
  const snapshot = await buildProgramScoreboardSnapshot({
    activeUsers: {
      sourceState: "ready",
      snapshots: [
        {
          at: "2026-06-14T09:00:00.000Z",
          activeUserCount: 100,
          firstValueEventName: "signup",
          source: "core_activation_snapshot",
        },
        {
          at: "2026-06-15T09:00:00.000Z",
          activeUserCount: 101,
          firstValueEventName: "account_created",
          source: "core_activation_snapshot",
        },
      ],
    },
  });

  assert.equal(snapshot.scoreboards.activeUsers100.acceptedCount, 0);
  assert.equal(snapshot.scoreboards.activeUsers100.passing, false);
});

test("firstRevenue accepts only paymentRecord", async () => {
  const snapshot = await buildProgramScoreboardSnapshot({
    programDay: 21,
    firstRevenue: {
      sourceState: "ready",
    },
    proofLedger: {
      events: [
        { id: "intent-1", type: "payment_intent", status: "accepted" },
        { id: "refusal-1", type: "refusal", status: "verified" },
        { id: "failure-1", type: "payment_failure", status: "submitted" },
        { id: "refund-1", type: "refund", status: "accepted" },
        { id: "record-rejected", type: "payment_record", status: "rejected", amount: 50 },
        { id: "self-report-1", type: "self_report", status: "accepted", amount: 50 },
      ],
    },
  });

  assert.equal(snapshot.scoreboards.firstRevenue.acceptedCount, 0);
  assert.deepEqual(snapshot.scoreboards.firstRevenue.learningCounts, {
    paymentIntent: 1,
    refusal: 1,
    paymentFailure: 1,
    refund: 1,
    "self-report": 1,
  });
  assert.deepEqual(snapshot.scoreboards.firstRevenue.excludedCounts, {
    rejectedPaymentRecord: 1,
  });
  assert.equal(snapshot.scoreboards.firstRevenue.sourceState, "ready");
  assert.equal(snapshot.scoreboards.firstRevenue.passing, false);

  const withRecord = await buildProgramScoreboardSnapshot({
    programDay: 22,
    proofLedger: {
      events: [
        { id: "intent-1", type: "payment_intent", status: "accepted" },
        { id: "record-1", type: "payment_record", status: "verified", amount: 1 },
      ],
    },
  });
  assert.equal(withRecord.scoreboards.firstRevenue.acceptedCount, 1);
  assert.equal(withRecord.scoreboards.firstRevenue.learningCounts.paymentIntent, 1);
  assert.equal(withRecord.scoreboards.firstRevenue.passing, true);
});

test("manual_proof_required and stale source states are visible but non-passing", async () => {
  const snapshot = await buildProgramScoreboardSnapshot({
    activeUsers: {
      sourceState: "manual_proof_required",
      snapshots: [
        {
          at: "2026-06-12T09:00:00.000Z",
          activeUserCount: 101,
          firstValueEventName: "first_value",
          source: "posthog_hogql",
        },
      ],
    },
    firstRevenue: {
      sourceState: "stale",
    },
    proofLedger: {
      events: [{ id: "record-1", type: "payment_record", status: "verified" }],
    },
  });

  assert.equal(snapshot.scoreboards.activeUsers100.acceptedCount, 0);
  assert.equal(snapshot.scoreboards.activeUsers100.sourceState, "manual_proof_required");
  assert.equal(snapshot.scoreboards.activeUsers100.passing, false);
  assert.equal(snapshot.scoreboards.firstRevenue.acceptedCount, 0);
  assert.equal(snapshot.scoreboards.firstRevenue.sourceState, "stale");
  assert.equal(snapshot.scoreboards.firstRevenue.passing, false);
});

test("rejected source states are visible but non-passing", async () => {
  const snapshot = await buildProgramScoreboardSnapshot({
    activeUsers: {
      sourceState: "rejected",
      snapshots: [
        {
          at: "2026-06-12T09:00:00.000Z",
          activeUserCount: 101,
          firstValueEventName: "first_value",
          source: "posthog_hogql",
        },
      ],
    },
    firstRevenue: {
      sourceState: "rejected",
    },
    proofLedger: {
      events: [{ id: "record-1", type: "payment_record", status: "verified" }],
    },
  });

  assert.equal(snapshot.scoreboards.activeUsers100.acceptedCount, 0);
  assert.equal(snapshot.scoreboards.activeUsers100.sourceState, "rejected");
  assert.equal(snapshot.scoreboards.activeUsers100.passing, false);
  assert.equal(snapshot.scoreboards.firstRevenue.acceptedCount, 0);
  assert.equal(snapshot.scoreboards.firstRevenue.sourceState, "rejected");
  assert.equal(snapshot.scoreboards.firstRevenue.passing, false);
});

test("firstRevenue accepts verified presale deposit proof", async () => {
  const snapshot = await buildProgramScoreboardSnapshot({
    firstRevenue: {
      sourceState: "ready",
    },
    proofLedger: {
      events: [
        { id: "deposit-1", type: "presale_deposit", status: "verified", amount: 10 },
        { id: "deposit-rejected", type: "presale_deposit", status: "rejected", amount: 10 },
      ],
    },
  });

  assert.equal(snapshot.scoreboards.firstRevenue.acceptedCount, 1);
  assert.deepEqual(snapshot.scoreboards.firstRevenue.excludedCounts, {
    rejectedPresaleDeposit: 1,
  });
  assert.equal(snapshot.scoreboards.firstRevenue.passing, true);
});

test("presale_deposit counts as firstRevenue accepted proof through proof ledger append", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "program-scoreboard-presale-"));
  try {
    await appendProofLedgerEvent({
      workspaceRoot,
      now: new Date("2026-06-20T09:00:00.000Z"),
      event: {
        id: "deposit-append-1",
        type: "presale_deposit",
        status: "verified",
        strength: "strong",
        amount: 10,
      },
    });
    await appendProofLedgerEvent({
      workspaceRoot,
      now: new Date("2026-06-20T09:01:00.000Z"),
      event: {
        id: "deposit-rejected-1",
        type: "presale_deposit",
        status: "rejected",
        strength: "strong",
        amount: 10,
      },
    });
    const ledger = await loadProofLedger({ workspaceRoot });
    assert.deepEqual(ledger.events.map((event) => event.type), ["presale_deposit", "presale_deposit"]);

    const snapshot = await buildProgramScoreboardSnapshot({
      firstRevenue: { sourceState: "ready" },
      proofLedger: ledger,
    });
    assert.equal(snapshot.scoreboards.firstRevenue.acceptedCount, 1);
    assert.deepEqual(snapshot.scoreboards.firstRevenue.excludedCounts, {
      rejectedPresaleDeposit: 1,
    });
    assert.equal(snapshot.scoreboards.firstRevenue.passing, true);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("invalid source state fails explicitly", async () => {
  await assert.rejects(
    buildProgramScoreboardSnapshot({
      activeUsers: { sourceState: "probably_ready" },
    }),
    /ERR_INVALID_SOURCE_STATE/,
  );
});

test("unsupported proof type fails explicitly", async () => {
  await assert.rejects(
    buildProgramScoreboardSnapshot({
      proofLedger: {
        events: [{ id: "unknown-1", type: "calendar_invite", status: "accepted" }],
      },
    }),
    /ERR_UNSUPPORTED_PROOF_TYPE/,
  );
});

test("malformed snapshot and proof containers fail explicitly", async () => {
  await assert.rejects(
    buildProgramScoreboardSnapshot({
      activeUsers: {
        snapshots: { at: "2026-06-14T09:00:00.000Z", activeUserCount: 100 },
      },
    }),
    /ERR_INVALID_ACTIVE_USER_SNAPSHOTS: activeUsers\.snapshots must be an array\./,
  );

  await assert.rejects(
    buildProgramScoreboardSnapshot({
      proofLedger: {
        events: { id: "record-1", type: "payment_record", status: "verified" },
      },
    }),
    /ERR_INVALID_PROOF_EVENTS: proofLedger\.events must be an array\./,
  );

  await assert.rejects(
    buildProgramScoreboardSnapshot({
      proofEvents: { id: "record-1", type: "payment_record", status: "verified" },
    }),
    /ERR_INVALID_PROOF_EVENTS: proofEvents must be an array\./,
  );
});

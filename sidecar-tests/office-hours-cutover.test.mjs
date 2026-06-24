// R1.b vertical-cutover harness — proves the ValidationAttempt event store +
// pure contract behave as the runtime authority the locked Day-1 get_users
// office-hours flow now wires to in sidecar/index.mjs.
//
// index.mjs cannot be imported here (it has daemon boot side-effects — see
// project memory), so this exercises the exact store + contract API surface the
// cut depends on, mirroring the index.mjs helpers (buildAttemptCommandFromCard /
// attemptCompletionPredicates / the promotion + submit + revise + restore wiring).
// What it pins:
//   1. 6-card promotion order via nextAttemptAction + the 6 commits → gather done.
//   2. submit commit-before-response idempotency (retry == applied:false, no dup).
//   3. CAS conflict on a stale expectedRevision.
//   4. prior-session resume by store lookup (projection is session-agnostic).
//   5. revise via supersedeAnswer (pre-action only; post-action rejected).
//   6. attemptCompletionPredicates separation (gather vs acceptable close).
//   7. generation-token round-trip: the {attemptId, expectedRevision, cardType,
//      transition} a card is bound to survives and binds the submit commit.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  startAttempt,
  commitAttemptEvent,
  supersedeAnswer,
  projectAttempt,
  loadAttemptLog,
  markPosted,
  markConsumed,
  pendingDeliveries,
} from "../sidecar/office-hours-attempt-store.mjs";

import {
  nextAttemptAction,
  cardDefinition,
  canonicalCardForSignal,
  isAcceptableDay1Close,
  VALIDATION_ATTEMPT_ACTIVE_STATES,
} from "../sidecar/office-hours-contract.mjs";

const GET_USERS_CARD_ORDER = [
  "activation_definition",
  "candidate_selection",
  "current_alternative",
  "action_request",
  "evidence_contract",
  "commitment",
];

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "oh-cutover-"));
}

// Mirror index.mjs buildAttemptCommandFromCard: card → transition + filled fields.
function buildCommand(signalId, answer, at) {
  const cardType = canonicalCardForSignal(signalId);
  const card = cardDefinition(cardType);
  assert.ok(card, `card for ${signalId}`);
  const fields = {};
  if (card.transition === "schedule_execution") {
    const baseMs = Date.parse(at);
    fields.dueAt = new Date(baseMs + 24 * 60 * 60 * 1000).toISOString();
    fields.commitmentNote = answer;
  } else {
    for (const key of card.requiredFields || []) fields[key] = answer;
  }
  return { type: card.transition, fields, cardType };
}

// Mirror index.mjs attemptCompletionPredicates.
function completionPredicates(projection) {
  let action = null;
  try {
    action = nextAttemptAction(projection);
  } catch {
    action = null;
  }
  return {
    gatherComplete: Boolean(action) && action.kind !== "card",
    acceptableDay1Close: (() => {
      try {
        return isAcceptableDay1Close(projection) === true;
      } catch {
        return false;
      }
    })(),
    attemptResolved: action?.kind === "terminal",
  };
}

// Drive the promotion → submit cycle for one card the way index.mjs does:
//   1. project + read nextAttemptAction → the card to render (the "generation").
//   2. stamp {attemptId, expectedRevision, cardType, transition} (promotion).
//   3. commit the answer at expectedRevision (submit), with responsePayload.
async function promoteAndAnswer(workspaceRoot, attemptId, sessionId, signalIdHint, answer, at) {
  const before = await projectAttempt({ workspaceRoot, attemptId });
  const action = nextAttemptAction(before.projection);
  assert.equal(action.kind, "card", "expected a card to promote");
  const card = cardDefinition(action.cardType);
  const generation = {
    attemptId,
    expectedRevision: before.revision,
    cardType: action.cardType,
    transition: card.transition,
    signalId: card.legacySignalId,
  };
  const requestId = `req-${action.cardType}-${before.revision}`;
  const command = buildCommand(generation.signalId, answer, at);
  const result = await commitAttemptEvent({
    workspaceRoot,
    attemptId: generation.attemptId,
    expectedRevision: generation.expectedRevision,
    event: {
      type: command.type,
      fields: command.fields,
      at,
      requestId,
      sessionId,
      audit: { questionText: `Q ${action.cardType}`, responseText: answer, promptSnapshot: null, submissions: [] },
    },
    responsePayload: { sessionId, requestId, response: { responses: [{ freeText: answer }] } },
  });
  return { generation, requestId, result, command };
}

test("R1.b: 6-card promotion order via nextAttemptAction; 6 commits → gather done", async () => {
  const ws = await makeWorkspace();
  const attemptId = "attempt-promotion";
  await startAttempt({ workspaceRoot: ws, goalLane: "get_users", day: 1, source: "test", sessionId: "S1", attemptId });

  const seenOrder = [];
  for (let i = 0; i < GET_USERS_CARD_ORDER.length; i += 1) {
    const snap = await projectAttempt({ workspaceRoot: ws, attemptId });
    const action = nextAttemptAction(snap.projection);
    assert.equal(action.kind, "card");
    seenOrder.push(action.cardType);
    await promoteAndAnswer(ws, attemptId, "S1", cardDefinition(action.cardType).legacySignalId, `answer ${i}`, "2026-06-24T00:00:00.000Z");
  }
  assert.deepEqual(seenOrder, GET_USERS_CARD_ORDER, "cards promote in the locked ladder order");

  const final = await projectAttempt({ workspaceRoot: ws, attemptId });
  const predicates = completionPredicates(final.projection);
  assert.equal(predicates.gatherComplete, true, "gather complete after 6 commits");
  assert.equal(nextAttemptAction(final.projection).kind, "wait", "scheduled → wait, not a 7th card");
  assert.equal(final.projection.status, "execution_scheduled");
});

test("R1.b: submit commit-before-response is idempotent on retry (no duplicate)", async () => {
  const ws = await makeWorkspace();
  const attemptId = "attempt-idem";
  await startAttempt({ workspaceRoot: ws, goalLane: "get_users", day: 1, source: "test", sessionId: "S1", attemptId });

  const at = "2026-06-24T00:00:00.000Z";
  const before = await projectAttempt({ workspaceRoot: ws, attemptId });
  const command = buildCommand("get_users_active_user_definition", "runs core flow", at);
  const event = {
    type: command.type,
    fields: command.fields,
    at,
    requestId: "req-idem-1",
    sessionId: "S1",
    audit: { questionText: "Q", responseText: "runs core flow", promptSnapshot: null, submissions: [] },
  };
  const responsePayload = { sessionId: "S1", requestId: "req-idem-1", response: { responses: [{ freeText: "x" }] } };

  const first = await commitAttemptEvent({ workspaceRoot: ws, attemptId, expectedRevision: before.revision, event, responsePayload });
  assert.equal(first.applied, true);
  assert.equal(first.revision, before.revision + 1);

  // Retry with the SAME requestId (a re-submit / crash-retry) — idempotent no-op.
  const retry = await commitAttemptEvent({ workspaceRoot: ws, attemptId, expectedRevision: before.revision, event, responsePayload });
  assert.equal(retry.applied, false, "retry does not re-apply");
  assert.equal(retry.revision, first.revision, "revision unchanged on retry");

  const log = await loadAttemptLog({ workspaceRoot: ws });
  const evs = log.attempts[attemptId].events.filter((e) => e.eventId === "req-idem-1");
  assert.equal(evs.length, 1, "exactly one event for the requestId (no duplicate)");
});

test("R1.b: CAS conflict on a stale expectedRevision (fail-closed)", async () => {
  const ws = await makeWorkspace();
  const attemptId = "attempt-cas";
  await startAttempt({ workspaceRoot: ws, goalLane: "get_users", day: 1, source: "test", sessionId: "S1", attemptId });
  const at = "2026-06-24T00:00:00.000Z";

  // Answer card 1 → revision advances to 1.
  await promoteAndAnswer(ws, attemptId, "S1", "get_users_active_user_definition", "a1", at);

  // A stale card still pointing at expectedRevision 0 must be rejected on commit.
  const staleCommand = buildCommand("get_users_first_candidate", "candidate X", at);
  await assert.rejects(
    () => commitAttemptEvent({
      workspaceRoot: ws,
      attemptId,
      expectedRevision: 0, // stale — store is at revision 1
      event: { type: staleCommand.type, fields: staleCommand.fields, at, requestId: "req-stale", sessionId: "S1" },
      responsePayload: { sessionId: "S1", requestId: "req-stale", response: {} },
    }),
    (err) => err.code === "ERR_ATTEMPT_REVISION_CONFLICT",
  );
});

test("R1.b: prior-session resume by store lookup (projection is session-agnostic)", async () => {
  const ws = await makeWorkspace();
  const attemptId = "attempt-resume";
  // Session A starts and answers two cards.
  await startAttempt({ workspaceRoot: ws, goalLane: "get_users", day: 1, source: "test", sessionId: "A", attemptId });
  const at = "2026-06-24T00:00:00.000Z";
  await promoteAndAnswer(ws, attemptId, "A", "get_users_active_user_definition", "a1", at);
  await promoteAndAnswer(ws, attemptId, "A", "get_users_first_candidate", "candidate X", at);

  // Session B (daemon restart / new session) recovers the attempt by store scan:
  // exactly the ensureOfficeHoursAttemptForSession recovery path.
  const log = await loadAttemptLog({ workspaceRoot: ws });
  let recovered = null;
  for (const record of Object.values(log.attempts)) {
    if (record.goalLane !== "get_users") continue;
    const snap = await projectAttempt({ workspaceRoot: ws, attemptId: record.attemptId });
    const action = nextAttemptAction(snap.projection);
    if (action.kind !== "terminal") {
      recovered = { attemptId: record.attemptId, revision: snap.revision, projection: snap.projection };
      break;
    }
  }
  assert.ok(recovered, "open attempt is recovered from the store");
  assert.equal(recovered.attemptId, attemptId);
  // The recovered projection reflects BOTH session-A answers (session-agnostic fold).
  const action = nextAttemptAction(recovered.projection);
  assert.equal(action.kind, "card");
  assert.equal(action.cardType, "current_alternative", "resumes at card 3, not card 1");

  // Session B answers card 3 at the recovered revision and the chain continues.
  const next = await promoteAndAnswer(ws, attemptId, "B", "get_users_current_alternative", "spreadsheet", at);
  assert.equal(next.result.applied, true);
});

test("R1.b: revise via supersedeAnswer (pre-action only; post-action rejected)", async () => {
  const ws = await makeWorkspace();
  const attemptId = "attempt-revise";
  await startAttempt({ workspaceRoot: ws, goalLane: "get_users", day: 1, source: "test", sessionId: "S1", attemptId });
  const at = "2026-06-24T00:00:00.000Z";

  // Answer card 1, then revise it before any irreversible action.
  const first = await promoteAndAnswer(ws, attemptId, "S1", "get_users_active_user_definition", "first answer", at);
  const afterFirst = await projectAttempt({ workspaceRoot: ws, attemptId });

  const card = cardDefinition("activation_definition");
  const replacementFields = { activationDefinition: "revised answer" };
  const superseded = await supersedeAnswer({
    workspaceRoot: ws,
    attemptId,
    expectedRevision: afterFirst.revision,
    targetEventId: first.requestId,
    cardType: "activation_definition",
    transition: card.transition,
    replacement: { type: card.transition, fields: replacementFields, at },
  });
  assert.equal(superseded.applied, true, "supersede applied pre-action");
  assert.equal(superseded.projection.activationDefinition, "revised answer");
  // Still at card 2 after the revision (revision replaced, not advanced past).
  assert.equal(nextAttemptAction(superseded.projection).cardType, "candidate_selection");

  // Now complete all 6 cards (drive to execution_scheduled = post gather).
  // Card 1 already answered; answer 2..6.
  for (const signalHint of [
    "get_users_first_candidate",
    "get_users_current_alternative",
    "get_users_today_request",
    "get_users_evidence_format",
    "get_users_day1_commitment",
  ]) {
    await promoteAndAnswer(ws, attemptId, "S1", signalHint, "ans", at);
  }
  const scheduled = await projectAttempt({ workspaceRoot: ws, attemptId });
  assert.equal(scheduled.projection.status, "execution_scheduled");

  // A revise after the plan is committed to execution (WAIT state) is rejected.
  await assert.rejects(
    () => supersedeAnswer({
      workspaceRoot: ws,
      attemptId,
      expectedRevision: scheduled.revision,
      targetEventId: first.requestId,
      cardType: "activation_definition",
      transition: card.transition,
      replacement: { type: card.transition, fields: { activationDefinition: "too late" }, at },
    }),
    (err) => err.code === "ERR_SUPERSEDE_AFTER_IRREVERSIBLE",
  );
});

test("R1.b: attemptCompletionPredicates separate gather vs acceptable Day-1 close", async () => {
  const ws = await makeWorkspace();
  const attemptId = "attempt-predicates";
  await startAttempt({ workspaceRoot: ws, goalLane: "get_users", day: 1, source: "test", sessionId: "S1", attemptId });
  const at = "2026-06-24T00:00:00.000Z";

  // Mid-gather: not complete, not an acceptable close.
  await promoteAndAnswer(ws, attemptId, "S1", "get_users_active_user_definition", "a", at);
  const mid = await projectAttempt({ workspaceRoot: ws, attemptId });
  const midP = completionPredicates(mid.projection);
  assert.equal(midP.gatherComplete, false);
  assert.equal(midP.acceptableDay1Close, false);

  // Finish the ladder → scheduled with a real future dueAt = acceptable close.
  for (const hint of [
    "get_users_first_candidate",
    "get_users_current_alternative",
    "get_users_today_request",
    "get_users_evidence_format",
    "get_users_day1_commitment",
  ]) {
    await promoteAndAnswer(ws, attemptId, "S1", hint, "a", at);
  }
  const done = await projectAttempt({ workspaceRoot: ws, attemptId });
  const doneP = completionPredicates(done.projection);
  assert.equal(doneP.gatherComplete, true, "gather complete");
  assert.equal(doneP.acceptableDay1Close, true, "execution_scheduled with future dueAt is an acceptable Day-1 close");
  assert.equal(doneP.attemptResolved, false, "scheduled is not terminal");
});

test("R1.b: generation-token round-trip binds the submit commit; durable outbox re-post", async () => {
  const ws = await makeWorkspace();
  const attemptId = "attempt-token";
  await startAttempt({ workspaceRoot: ws, goalLane: "get_users", day: 1, source: "test", sessionId: "S1", attemptId });
  const at = "2026-06-24T00:00:00.000Z";

  // Promotion stamps the token; submit commits AT that token (binds card↔revision).
  const before = await projectAttempt({ workspaceRoot: ws, attemptId });
  const action = nextAttemptAction(before.projection);
  const card = cardDefinition(action.cardType);
  const token = { attemptId, expectedRevision: before.revision, cardType: action.cardType, transition: card.transition, signalId: card.legacySignalId };

  // Token survives a JSON serialize round-trip (the persist/restore path).
  const restoredToken = JSON.parse(JSON.stringify({ generation: { mode: "office_hours_inline", signalId: token.signalId, ...token } })).generation;
  assert.equal(restoredToken.attemptId, attemptId);
  assert.equal(restoredToken.expectedRevision, before.revision);
  assert.equal(restoredToken.cardType, action.cardType);
  assert.equal(restoredToken.transition, card.transition);

  const command = buildCommand(restoredToken.signalId, "core flow", at);
  const result = await commitAttemptEvent({
    workspaceRoot: ws,
    attemptId: restoredToken.attemptId,
    expectedRevision: restoredToken.expectedRevision,
    event: { type: command.type, fields: command.fields, at, requestId: "req-token-1", sessionId: "S1" },
    responsePayload: { sessionId: "S1", requestId: "req-token-1", response: { ok: true } },
  });
  assert.equal(result.applied, true);

  // Durable outbox: the delivery is pending (committed, not yet consumed). Boot
  // re-post writes the response file then markPosted; markConsumed clears it.
  let deliveries = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(deliveries.length, 1, "one pending delivery after commit");
  assert.equal(deliveries[0].eventId, "req-token-1");
  assert.deepEqual(deliveries[0].responsePayload.response, { ok: true });

  await markPosted({ workspaceRoot: ws, attemptId, eventId: "req-token-1" });
  deliveries = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(deliveries.length, 1, "posted-but-not-consumed is still a re-post target");
  assert.equal(deliveries[0].status, "posted");

  await markConsumed({ workspaceRoot: ws, attemptId, eventId: "req-token-1" });
  deliveries = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(deliveries.length, 0, "consumed delivery is no longer re-posted");
});

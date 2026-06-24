// Crash / restart / concurrency / idempotency / supersede harness for the Office
// Hours attempt store (R1.a infra-only, with the GPT R1.b P0 fixes). Crashes are
// simulated by writing intermediate-state files and doing a fresh load + replay —
// deterministic, no real process kills (the store is pure-function + file based).
//
// Legacy turn-log migration was removed entirely (owner directive): no
// buildOfficeHoursMigrationPlan / buildValidationAttemptFromTurns / legacy_imported.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  OFFICE_HOURS_ATTEMPTS_SCHEMA_VERSION,
  OFFICE_HOURS_ATTEMPTS_SCHEMA,
  AttemptStoreError,
  resolveOfficeHoursAttemptLogPath,
  loadAttemptLog,
  startAttempt,
  commitAttemptEvent,
  supersedeAnswer,
  supersedeCommandId,
  projectAttempt,
  projectAttemptFromEvents,
  markPosted,
  markConsumed,
  markCanceled,
  pendingDeliveries,
  assertSameCommandPayload,
  withAttemptLeaseLock,
} from "../sidecar/office-hours-attempt-store.mjs";

import {
  cardDefinition,
} from "../sidecar/office-hours-contract.mjs";

// ── test helpers ──────────────────────────────────────────────────────────────
async function makeWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oh-attempt-store-"));
  return dir;
}

const ISO = "2026-06-24T00:00:00.000Z";

function activationEvent(requestId, overrides = {}) {
  return {
    type: "define_activation",
    requestId,
    fields: { activationDefinition: "user runs the core flow once" },
    at: ISO,
    sessionId: "S1",
    audit: { questionText: "What is activation?", responseText: "runs core flow", promptSnapshot: null, submissions: [] },
    ...overrides,
  };
}

function candidateEvent(requestId, candidate, overrides = {}) {
  return {
    type: "select_candidate",
    requestId,
    fields: { candidate },
    at: ISO,
    sessionId: "S1",
    ...overrides,
  };
}

async function readRawLog(workspaceRoot) {
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot });
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

// Simulate a crash by writing a hand-built intermediate-state file, then loading
// fresh. (The store never holds in-process cache, so "fresh load" == restart.)
async function writeRawLog(workspaceRoot, log) {
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(log, null, 2));
}

// ── startAttempt ──────────────────────────────────────────────────────────────
test("startAttempt creates an empty record at revision 0", async () => {
  const ws = await makeWorkspace();
  const record = await startAttempt({
    workspaceRoot: ws, goalLane: "get_users", day: 1, source: "office_hours",
    sessionId: "S1", attemptId: "a1", now: new Date(ISO),
  });
  assert.equal(record.attemptId, "a1");
  assert.equal(record.revision, 0);
  assert.deepEqual(record.events, []);
  assert.deepEqual(record.deliveries, {});
  assert.equal(record.day, 1);
  assert.equal(record.source, "office_hours");
  assert.equal(record.createdSessionId, "S1");

  const log = await readRawLog(ws);
  assert.equal(log.schemaVersion, OFFICE_HOURS_ATTEMPTS_SCHEMA_VERSION);
  assert.equal(log.schema, OFFICE_HOURS_ATTEMPTS_SCHEMA);
  assert.ok(log.attempts.a1);
});

test("startAttempt throws ERR_ATTEMPT_ALREADY_OPEN when an unresolved attempt exists", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await assert.rejects(
    () => startAttempt({ workspaceRoot: ws, attemptId: "a2", now: new Date(ISO) }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_ATTEMPT_ALREADY_OPEN",
  );
});

test("startAttempt allows a new attempt once the prior one is resolved (terminal)", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0,
    event: { type: "abandon_attempt", requestId: "r-abandon", fields: { abandonReason: "scope cut" }, at: ISO },
  });
  const snap = await projectAttempt({ workspaceRoot: ws, attemptId: "a1" });
  assert.equal(snap.projection.status, "failed");
  const a2 = await startAttempt({ workspaceRoot: ws, attemptId: "a2", now: new Date(ISO) });
  assert.equal(a2.revision, 0);
});

test("startAttempt requires an attemptId", async () => {
  const ws = await makeWorkspace();
  await assert.rejects(
    () => startAttempt({ workspaceRoot: ws }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_NO_ATTEMPT_ID",
  );
});

// ── commit happy path ─────────────────────────────────────────────────────────
test("commit happy path: define_activation → revision 1, status needs_candidate", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  const res = await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1"),
  });
  assert.equal(res.applied, true);
  assert.equal(res.revision, 1);
  assert.equal(res.eventId, "r1");
  assert.equal(res.projection.status, "needs_candidate");

  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.revision, 1);
  assert.equal(log.attempts.a1.events.length, 1);
  assert.equal(log.attempts.a1.events[0].audit.responseText, "runs core flow");
  assert.equal(log.attempts.a1.events[0].requestId, "r1");
  assert.equal(log.attempts.a1.events[0].eventId, "r1");
});

// ── idempotency BEFORE CAS (GPT#1) ────────────────────────────────────────────
test("idempotency-before-CAS: same requestId + same payload with STALE expectedRevision returns applied:false (not a CAS error)", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  const retry = await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1"),
  });
  assert.equal(retry.applied, false);
  assert.equal(retry.revision, 1);
  assert.equal(retry.projection.status, "needs_candidate");
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.events.length, 1, "events length must NOT grow on idempotent retry");
});

// ── at-drift idempotency ──────────────────────────────────────────────────────
test("at-drift: same requestId + same fields but different `at` is idempotent (applied:false, no conflict)", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  const retry = await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 1,
    event: activationEvent("r1", { at: "2026-12-31T23:59:59.000Z" }),
  });
  assert.equal(retry.applied, false);
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.events.length, 1);
});

test("same requestId + DIFFERENT fields throws ERR_EVENT_ID_CONFLICT", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  await assert.rejects(
    () => commitAttemptEvent({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 1,
      event: activationEvent("r1", { fields: { activationDefinition: "DIFFERENT definition" } }),
    }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_EVENT_ID_CONFLICT",
  );
});

// ── E: idempotency hash includes audit ─────────────────────────────────────────
test("idempotency-hash-includes-audit: same requestId + same fields but DIFFERENT audit → ERR_EVENT_ID_CONFLICT", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  // Same requestId + identical fields, but the captured answer (audit.responseText)
  // differs → this is a genuine conflict, NOT a false dedupe.
  await assert.rejects(
    () => commitAttemptEvent({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 1,
      event: activationEvent("r1", {
        audit: { questionText: "What is activation?", responseText: "DIFFERENT captured answer", promptSnapshot: null, submissions: [] },
      }),
    }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_EVENT_ID_CONFLICT",
  );
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.events.length, 1, "conflict must not append");
});

test("idempotency-hash-includes-audit: same requestId + same fields + SAME audit (different `at`) is still idempotent", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  const retry = await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 1,
    event: activationEvent("r1", { at: "2027-01-01T00:00:00.000Z" }),
  });
  assert.equal(retry.applied, false, "identical fields+audit → idempotent despite `at` drift");
});

// ── CAS conflict ──────────────────────────────────────────────────────────────
test("CAS: a first-seen event with a stale expectedRevision throws ERR_ATTEMPT_REVISION_CONFLICT", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  await assert.rejects(
    () => commitAttemptEvent({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 0,
      event: candidateEvent("r2", "조은성"),
    }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_ATTEMPT_REVISION_CONFLICT",
  );
});

// ── concurrent same-revision submits (CP6) ────────────────────────────────────
test("CP6 concurrent same-revision: two DIFFERENT events at the same expectedRevision → one applied, one CONFLICT, events +1", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  const a = commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("rA") });
  const b = commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0,
    event: { type: "define_activation", requestId: "rB", fields: { activationDefinition: "other" }, at: ISO },
  });
  const results = await Promise.allSettled([a, b]);
  const applied = results.filter((r) => r.status === "fulfilled" && r.value.applied);
  const conflicts = results.filter((r) => r.status === "rejected" && r.reason?.code === "ERR_ATTEMPT_REVISION_CONFLICT");
  assert.equal(applied.length, 1, "exactly one applied");
  assert.equal(conflicts.length, 1, "exactly one CAS conflict");
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.events.length, 1, "events grows by exactly 1");
});

test("CP6 concurrent same-revision SAME event: one applied:true, one applied:false (idempotent), events +1", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  const a = commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("rSame") });
  const b = commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("rSame") });
  const results = await Promise.allSettled([a, b]);
  const ok = results.filter((r) => r.status === "fulfilled");
  assert.equal(ok.length, 2, "both resolve (no conflict for same eventId)");
  const appliedTrue = ok.filter((r) => r.value.applied === true);
  const appliedFalse = ok.filter((r) => r.value.applied === false);
  assert.equal(appliedTrue.length, 1);
  assert.equal(appliedFalse.length, 1);
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.events.length, 1);
});

// ── durable outbox 3-state (GPT R1.b D) ───────────────────────────────────────
test("outbox 3-state: pending → posted → consumed; pendingDeliveries returns pending+posted, excludes consumed", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1"),
    responsePayload: { ok: true, card: "candidate_selection" },
  });
  let log = await readRawLog(ws);
  assert.equal(log.attempts.a1.deliveries.r1.status, "pending");
  assert.deepEqual(log.attempts.a1.deliveries.r1.responsePayload, { ok: true, card: "candidate_selection" });

  // pending is a re-post target.
  let pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].attemptId, "a1");
  assert.equal(pending[0].eventId, "r1");
  assert.equal(pending[0].status, "pending");

  // pending → posted. STILL a re-post target (posted-but-not-consumed survives a crash).
  const posted = await markPosted({ workspaceRoot: ws, attemptId: "a1", eventId: "r1" });
  assert.equal(posted.applied, true);
  assert.equal(posted.status, "posted");
  pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(pending.length, 1, "a posted-but-not-consumed delivery is still a re-post target");
  assert.equal(pending[0].status, "posted");

  // posted → consumed. NO longer a re-post target.
  const consumed = await markConsumed({ workspaceRoot: ws, attemptId: "a1", eventId: "r1" });
  assert.equal(consumed.applied, true);
  assert.equal(consumed.status, "consumed");
  pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(pending.length, 0);
});

test("outbox 3-state: markPosted / markConsumed are idempotent; illegal back-transition throws", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1"),
    responsePayload: { ok: true },
  });
  await markPosted({ workspaceRoot: ws, attemptId: "a1", eventId: "r1" });
  const postedAgain = await markPosted({ workspaceRoot: ws, attemptId: "a1", eventId: "r1" });
  assert.equal(postedAgain.applied, false, "re-posting is idempotent");
  await markConsumed({ workspaceRoot: ws, attemptId: "a1", eventId: "r1" });
  const consumedAgain = await markConsumed({ workspaceRoot: ws, attemptId: "a1", eventId: "r1" });
  assert.equal(consumedAgain.applied, false);
  // consumed → posted is illegal.
  await assert.rejects(
    () => markPosted({ workspaceRoot: ws, attemptId: "a1", eventId: "r1" }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_DELIVERY_TRANSITION",
  );
});

test("outbox re-post: crash after commit but before markConsumed → pending still visible on fresh load; re-post is idempotent", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1"),
    responsePayload: { ok: true },
  });
  await markPosted({ workspaceRoot: ws, attemptId: "a1", eventId: "r1" });
  // "Crash" = no markConsumed. Fresh load (restart) still sees it as a re-post target.
  const pendingAfterCrash = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(pendingAfterCrash.length, 1);
  assert.equal(pendingAfterCrash[0].status, "posted");
  // Re-post the same command (idempotent) — must not duplicate the event, must keep
  // the delivery a re-post target.
  const retry = await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 1, event: activationEvent("r1"),
    responsePayload: { ok: true },
  });
  assert.equal(retry.applied, false);
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.events.length, 1);
  assert.equal(log.attempts.a1.deliveries.r1.status, "posted", "re-commit does not clobber a posted delivery");
});

// ── CP1: commit appended, projection consumer crashed before reading ──────────
test("CP1 (crash after event append, before downstream): events[] alone reproject identically; resubmit is applied:false", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  const committed = await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1"),
  });
  const snap = await projectAttempt({ workspaceRoot: ws, attemptId: "a1" });
  assert.deepEqual(snap.projection, committed.projection);
  const resubmit = await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 1, event: activationEvent("r1"),
  });
  assert.equal(resubmit.applied, false);
});

// ── CP2: event appended, response write was lost ──────────────────────────────
test("CP2 (event appended, response write lost): re-commit with responsePayload re-queues a pending delivery", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  let log = await readRawLog(ws);
  assert.equal(log.attempts.a1.deliveries.r1, undefined, "no delivery yet");
  const retry = await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 1, event: activationEvent("r1"),
    responsePayload: { ok: true },
  });
  assert.equal(retry.applied, false, "idempotent: event already present");
  log = await readRawLog(ws);
  assert.equal(log.attempts.a1.deliveries.r1.status, "pending", "delivery re-queued");
  const pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(pending.length, 1);
});

// ── CP7: prior-session resume — fold is session-independent ───────────────────
test("CP7 (prior-session resume): events committed under session A then B reproject to the same session-independent projection", async () => {
  const wsAB = await makeWorkspace();
  await startAttempt({ workspaceRoot: wsAB, attemptId: "a1", sessionId: "SESSION-A", now: new Date(ISO) });
  await commitAttemptEvent({
    workspaceRoot: wsAB, attemptId: "a1", expectedRevision: 0,
    event: activationEvent("r1", { sessionId: "SESSION-A" }),
  });
  await commitAttemptEvent({
    workspaceRoot: wsAB, attemptId: "a1", expectedRevision: 1,
    event: candidateEvent("r2", "조은성", { sessionId: "SESSION-B" }),
  });
  const snapAB = await projectAttempt({ workspaceRoot: wsAB, attemptId: "a1" });

  const wsBA = await makeWorkspace();
  await startAttempt({ workspaceRoot: wsBA, attemptId: "a1", sessionId: "SESSION-B", now: new Date(ISO) });
  await commitAttemptEvent({
    workspaceRoot: wsBA, attemptId: "a1", expectedRevision: 0,
    event: activationEvent("r1", { sessionId: "SESSION-B" }),
  });
  await commitAttemptEvent({
    workspaceRoot: wsBA, attemptId: "a1", expectedRevision: 1,
    event: candidateEvent("r2", "조은성", { sessionId: "SESSION-A" }),
  });
  const snapBA = await projectAttempt({ workspaceRoot: wsBA, attemptId: "a1" });

  assert.deepEqual(snapAB.projection, snapBA.projection, "projection is independent of which session committed which event");
  assert.equal(snapAB.projection.status, "needs_alternative");
});

// ── strict loader (GPT#4) ─────────────────────────────────────────────────────
test("strict loader: a corrupt JSON file THROWS (NOT fail-open)", async () => {
  const ws = await makeWorkspace();
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot: ws });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "{ this is not json");
  await assert.rejects(
    () => loadAttemptLog({ workspaceRoot: ws }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_ATTEMPT_LOG_PARSE",
  );
});

test("strict loader: schemaVersion mismatch THROWS", async () => {
  const ws = await makeWorkspace();
  await writeRawLog(ws, { schemaVersion: 99, schema: "x", attempts: {} });
  await assert.rejects(
    () => loadAttemptLog({ workspaceRoot: ws }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_ATTEMPT_LOG_SCHEMA",
  );
});

test("strict loader: an absent file returns an empty attempts log (the only fail-open case)", async () => {
  const ws = await makeWorkspace();
  const log = await loadAttemptLog({ workspaceRoot: ws });
  assert.equal(log.schemaVersion, OFFICE_HOURS_ATTEMPTS_SCHEMA_VERSION);
  assert.deepEqual(log.attempts, {});
});

// hole 3 (adversarial-verify): a structurally-valid root with a per-record corrupt
// `events`/`deliveries` MUST throw — never be silently coerced to empty (which would
// fabricate authority and let a commit overwrite the corrupt-but-present data).
test("strict loader: a record with non-array events THROWS (no per-record fail-open)", async () => {
  const ws = await makeWorkspace();
  await writeRawLog(ws, {
    schemaVersion: OFFICE_HOURS_ATTEMPTS_SCHEMA_VERSION, schema: OFFICE_HOURS_ATTEMPTS_SCHEMA, updatedAt: ISO,
    attempts: { a1: { attemptId: "a1", goalLane: "get_users", revision: 3, createdAt: ISO, updatedAt: ISO, events: "CORRUPT-NOT-AN-ARRAY", deliveries: {} } },
  });
  await assert.rejects(
    () => loadAttemptLog({ workspaceRoot: ws }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_ATTEMPT_LOG_SCHEMA",
  );
});

test("strict loader: a record with non-object deliveries THROWS", async () => {
  const ws = await makeWorkspace();
  await writeRawLog(ws, {
    schemaVersion: OFFICE_HOURS_ATTEMPTS_SCHEMA_VERSION, schema: OFFICE_HOURS_ATTEMPTS_SCHEMA, updatedAt: ISO,
    attempts: { a1: { attemptId: "a1", goalLane: "get_users", revision: 0, createdAt: ISO, updatedAt: ISO, events: [], deliveries: "CORRUPT-NOT-AN-OBJECT" } },
  });
  await assert.rejects(
    () => loadAttemptLog({ workspaceRoot: ws }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_ATTEMPT_LOG_SCHEMA",
  );
});

test("strict loader: a well-formed record still loads", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", sessionId: "S1", now: new Date(ISO) });
  const log = await loadAttemptLog({ workspaceRoot: ws });
  assert.ok(log.attempts.a1);
  assert.deepEqual(log.attempts.a1.events, []);
});

// ── lease lock (no-steal / no foreign unlink) ─────────────────────────────────
test("lease lock: an unexpired foreign lock is NOT stolen", async () => {
  const ws = await makeWorkspace();
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot: ws });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  await fs.writeFile(lockPath, JSON.stringify({ owner: "OTHER-WRITER", at: new Date().toISOString() }));

  await assert.rejects(
    () => withAttemptLeaseLock(filePath, async () => "should-not-run", { timeoutMs: 30_000, acquireTimeoutMs: 120, pollMs: 20 }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_ATTEMPT_LOCK_TIMEOUT",
  );
  const after = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(after.owner, "OTHER-WRITER", "foreign lock must not be unlinked on release");
});

test("lease lock: an EXPIRED foreign lock IS stolen", async () => {
  const ws = await makeWorkspace();
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot: ws });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  await fs.writeFile(lockPath, JSON.stringify({ owner: "DEAD-WRITER", at: "2000-01-01T00:00:00.000Z" }));
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lockPath, old, old);

  const ran = await withAttemptLeaseLock(filePath, async () => "stolen-ok", { timeoutMs: 5_000, pollMs: 20 });
  assert.equal(ran, "stolen-ok");
  await assert.rejects(() => fs.stat(lockPath), (err) => err.code === "ENOENT");
});

test("lease lock: release does not unlink a lock another writer now owns", async () => {
  const ws = await makeWorkspace();
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot: ws });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;

  await withAttemptLeaseLock(filePath, async () => {
    await fs.writeFile(lockPath, JSON.stringify({ owner: "STOLE-IT", at: new Date().toISOString() }));
  }, { timeoutMs: 5_000, pollMs: 20 });

  const after = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(after.owner, "STOLE-IT", "we must only unlink a lock we still own");
});

// ── durable write validity ────────────────────────────────────────────────────
test("durable write: the persisted file is always valid JSON (no partial write)", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot: ws });
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.attempts.a1.revision, 1);
  const dirEntries = await fs.readdir(path.dirname(filePath));
  assert.ok(!dirEntries.some((e) => e.endsWith(".tmp")), "no temp files remain after a durable write");
});

// ── projector: supersede sequential processing (GPT R1.b C) ───────────────────
test("projector: answer_superseded replays the branch before targetEventId, drops superseded downstream, applies replacement; raw events preserved", async () => {
  const rawEvents = [
    { type: "define_activation", eventId: "e0", fields: { activationDefinition: "runs flow" }, at: ISO },
    { type: "select_candidate", eventId: "e1", fields: { candidate: "조은성" }, at: ISO },
    {
      type: "answer_superseded", eventId: "e2",
      fields: {
        targetEventId: "e1",
        replacement: { type: "select_candidate", fields: { candidate: "박조은" }, at: ISO },
      },
      at: ISO,
    },
  ];
  const proj = projectAttemptFromEvents(rawEvents, { id: "a1", goalLane: "get_users", createdAt: ISO });
  assert.equal(proj.candidate, "박조은", "replacement candidate wins");
  assert.equal(proj.status, "needs_alternative", "advanced past the (replaced) candidate slot");
  assert.equal(rawEvents.length, 3, "raw events preserved (logical, not physical, replacement)");
});

test("projector: supersede preserves events appended AFTER it (A,B,S(A→A'),C → [A', C]) (P0-3)", async () => {
  // A = select_candidate(e1), B = record_alternative(e2), S supersedes e1 with a new
  // candidate, C = record_alternative(e4) appended AFTER the supersede.
  // Sequential processing must keep C: branch = [define_activation, candidate', alt'].
  const rawEvents = [
    { type: "define_activation", eventId: "e0", fields: { activationDefinition: "runs flow" }, at: ISO },
    { type: "select_candidate", eventId: "e1", fields: { candidate: "조은성" }, at: ISO },     // A
    { type: "record_alternative", eventId: "e2", fields: { currentAlternative: "spreadsheet" }, at: ISO }, // B
    {                                                                                            // S(A→A')
      type: "answer_superseded", eventId: "e3",
      fields: { targetEventId: "e1", replacement: { type: "select_candidate", fields: { candidate: "박조은" }, at: ISO } },
      at: ISO,
    },
    { type: "record_alternative", eventId: "e4", fields: { currentAlternative: "google sheet" }, at: ISO }, // C
  ];
  const proj = projectAttemptFromEvents(rawEvents, { id: "a1", goalLane: "get_users", createdAt: ISO });
  // The supersede truncates back to before e1 (dropping the original candidate AND
  // B=e2), splices the replacement, then C=e4 replays on top → needs_action_contract.
  assert.equal(proj.candidate, "박조은", "replacement candidate wins");
  assert.equal(proj.currentAlternative, "google sheet", "C (appended after the supersede) is preserved");
  assert.equal(proj.status, "needs_action_contract", "C advanced past the alternative slot");
});

test("projector: repeated revision — supersede the same slot twice → last replacement wins, no ERR_SUPERSEDE_TARGET_MISSING", async () => {
  const rawEvents = [
    { type: "define_activation", eventId: "e0", fields: { activationDefinition: "runs flow" }, at: ISO },
    { type: "select_candidate", eventId: "e1", fields: { candidate: "후보1" }, at: ISO },
    {
      type: "answer_superseded", eventId: "e2",
      fields: { targetEventId: "e1", replacement: { type: "select_candidate", fields: { candidate: "후보2" }, at: ISO } },
      at: ISO,
    },
    {
      // second revision targets the replacement's synthetic eventId from the first supersede.
      type: "answer_superseded", eventId: "e3",
      fields: { targetEventId: "superseded:e2", replacement: { type: "select_candidate", fields: { candidate: "후보3" }, at: ISO } },
      at: ISO,
    },
  ];
  const proj = projectAttemptFromEvents(rawEvents, { id: "a1", goalLane: "get_users", createdAt: ISO });
  assert.equal(proj.candidate, "후보3", "the last replacement wins");
  assert.equal(proj.status, "needs_alternative");
});

test("projector: answer_superseded with a missing target throws ERR_SUPERSEDE_TARGET_MISSING", async () => {
  const rawEvents = [
    { type: "define_activation", eventId: "e0", fields: { activationDefinition: "x" }, at: ISO },
    {
      type: "answer_superseded", eventId: "e1",
      fields: { targetEventId: "NOPE", replacement: { type: "select_candidate", fields: { candidate: "y" }, at: ISO } },
      at: ISO,
    },
  ];
  assert.throws(
    () => projectAttemptFromEvents(rawEvents, { id: "a1" }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_SUPERSEDE_TARGET_MISSING",
  );
});

// hole 1 (adversarial-verify) — CORRECT-BEHAVIOR regression. This pins that
// re-revising an UPSTREAM slot (candidate) a second time, after a downstream slot
// (alternative) was answered against the intermediate value, correctly DROPS that
// downstream answer and re-asks it. The interview ladder is DEPENDENT (the
// alternative is "how does THIS candidate cope"), so an alternative answered for
// cand2 is stale once the candidate becomes cand3. Preserving it would be the bug.
// Matches the spec's own supersede rule (drop answers given against the OLD value,
// keep answers given against the NEW value). DO NOT "fix" this to preserve alt-X.
test("projector: re-revising an upstream slot correctly drops the now-stale downstream answer (hole-1 false-positive guard)", () => {
  const rawEvents = [
    { type: "define_activation", eventId: "e0", fields: { activationDefinition: "def-A" }, at: ISO },
    { type: "select_candidate", eventId: "e1", fields: { candidate: "cand1" }, at: ISO },
    { type: "answer_superseded", eventId: "S1", fields: { targetEventId: "e1", replacement: { type: "select_candidate", fields: { candidate: "cand2" }, at: ISO } }, at: ISO },
    { type: "record_alternative", eventId: "e2", fields: { currentAlternative: "alt-X" }, at: ISO },
    { type: "answer_superseded", eventId: "S2", fields: { targetEventId: "superseded:S1", replacement: { type: "select_candidate", fields: { candidate: "cand3" }, at: ISO } }, at: ISO },
  ];
  const proj = projectAttemptFromEvents(rawEvents, { id: "a1" });
  assert.equal(proj.candidate, "cand3");
  assert.equal(proj.currentAlternative, "", "alt-X (answered for cand2) is correctly dropped when candidate becomes cand3");
  assert.equal(proj.status, "needs_alternative", "ladder correctly re-asks the alternative for the new candidate");
});

// ── supersedeAnswer commit (GPT R1.b B + G) ───────────────────────────────────
async function seedCandidate(ws) {
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", sessionId: "S1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 1, event: candidateEvent("r2", "조은성") });
}

test("supersedeAnswer: answer_superseded commits successfully and revises the candidate (P0-2)", async () => {
  const ws = await makeWorkspace();
  await seedCandidate(ws);
  const before = await projectAttempt({ workspaceRoot: ws, attemptId: "a1" });
  assert.equal(before.projection.candidate, "조은성");
  assert.equal(before.revision, 2);

  const res = await supersedeAnswer({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 2,
    targetEventId: "r2", cardType: "candidate_selection", transition: "select_candidate",
    replacement: { type: "select_candidate", fields: { candidate: "박조은" }, at: ISO },
    now: new Date(ISO),
  });
  assert.equal(res.applied, true);
  assert.equal(res.revision, 3);
  assert.equal(res.projection.candidate, "박조은");
  assert.equal(res.projection.status, "needs_alternative");

  const after = await projectAttempt({ workspaceRoot: ws, attemptId: "a1" });
  assert.equal(after.projection.candidate, "박조은");
  // The answer_superseded event was durably appended.
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.events.length, 3);
  assert.equal(log.attempts.a1.events[2].type, "answer_superseded");
});

test("supersedeAnswer: retry with the same revision is idempotent (deterministic id, no double append)", async () => {
  const ws = await makeWorkspace();
  await seedCandidate(ws);
  const replacement = { type: "select_candidate", fields: { candidate: "박조은" }, at: ISO };
  const first = await supersedeAnswer({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 2,
    targetEventId: "r2", cardType: "candidate_selection", replacement, now: new Date(ISO),
  });
  assert.equal(first.applied, true);
  // The deterministic id must match the helper.
  assert.equal(first.eventId, supersedeCommandId("a1", "r2", replacement));
  // Re-send the SAME revision (even with a STALE expectedRevision) → idempotent.
  const retry = await supersedeAnswer({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 2,
    targetEventId: "r2", cardType: "candidate_selection", replacement, now: new Date(ISO),
  });
  assert.equal(retry.applied, false);
  assert.equal(retry.eventId, first.eventId);
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.events.length, 3, "no double append on idempotent retry");
});

test("supersedeAnswer: expectedTargetPayloadHash mismatch throws ERR_SUPERSEDE_TARGET_CHANGED", async () => {
  const ws = await makeWorkspace();
  await seedCandidate(ws);
  await assert.rejects(
    () => supersedeAnswer({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 2,
      targetEventId: "r2", cardType: "candidate_selection",
      expectedTargetPayloadHash: "deadbeefdeadbe",
      replacement: { type: "select_candidate", fields: { candidate: "박조은" }, at: ISO },
      now: new Date(ISO),
    }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_SUPERSEDE_TARGET_CHANGED",
  );
});

test("supersedeAnswer: CAS conflict for a first-seen supersede with a stale expectedRevision", async () => {
  const ws = await makeWorkspace();
  await seedCandidate(ws);
  await assert.rejects(
    () => supersedeAnswer({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, // stale (store at 2)
      targetEventId: "r2", cardType: "candidate_selection",
      replacement: { type: "select_candidate", fields: { candidate: "박조은" }, at: ISO },
      now: new Date(ISO),
    }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_ATTEMPT_REVISION_CONFLICT",
  );
});

test("supersedeAnswer: rejected after an irreversible transition (schedule_execution) — ERR_SUPERSEDE_AFTER_IRREVERSIBLE", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", sessionId: "S1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 1, event: candidateEvent("r2", "조은성") });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 2, event: { type: "record_alternative", requestId: "r3", fields: { currentAlternative: "spreadsheet" }, at: ISO } });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 3, event: { type: "define_action_contract", requestId: "r4", fields: { externalAction: "send DM", attemptThreshold: "1", successCondition: "tries it" }, at: ISO } });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 4, event: { type: "define_evidence_contract", requestId: "r5", fields: { expectedProofKind: "dm_sent_screenshot", evidenceLocation: "cap" }, at: ISO } });
  // schedule_execution = irreversible. dueAt must be > at.
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 5, event: { type: "schedule_execution", requestId: "r6", fields: { dueAt: "2026-06-24T18:00:00.000Z" }, at: ISO } });

  // Now try to revise the earlier candidate answer → rejected (plan committed to execution).
  await assert.rejects(
    () => supersedeAnswer({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 6,
      targetEventId: "r2", cardType: "candidate_selection",
      replacement: { type: "select_candidate", fields: { candidate: "박조은" }, at: ISO },
      now: new Date(ISO),
    }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_SUPERSEDE_AFTER_IRREVERSIBLE",
  );
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.events.length, 6, "nothing appended on a rejected supersede");
});

// re-verify HIGH: a TERMINAL attempt (closed via abandon_attempt — which carries
// none of the action transitions) must NOT be resurrectable by a supersede. GUARD 5
// gates on the PROJECTED status (not a transition-name set), so a non-gather status
// is rejected.
test("supersedeAnswer: cannot resurrect a terminal (abandoned→failed) attempt — ERR_SUPERSEDE_NOT_ACTIVE", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", sessionId: "S1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 1, event: candidateEvent("r2", "조은성") });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 2, event: { type: "abandon_attempt", requestId: "r3", fields: { abandonReason: "scope cut" }, at: ISO } });
  const before = await projectAttempt({ workspaceRoot: ws, attemptId: "a1" });
  assert.equal(before.projection.status, "failed");

  await assert.rejects(
    () => supersedeAnswer({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 3,
      targetEventId: "r2", cardType: "candidate_selection",
      replacement: { type: "select_candidate", fields: { candidate: "박조은" }, at: ISO },
      now: new Date(ISO),
    }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_SUPERSEDE_NOT_ACTIVE",
  );
  const after = await projectAttempt({ workspaceRoot: ws, attemptId: "a1" });
  assert.equal(after.projection.status, "failed", "terminal attempt stays failed; nothing appended");
  assert.equal(after.revision, 3);
});

// re-verify MEDIUM + LOW: the "superseded:" namespace is reserved. A caller cannot
// commit a reducer event with a requestId in that namespace, which is what let a
// later supersede over-cancel a surviving event's delivery.
test("commitAttemptEvent: rejects a requestId in a reserved namespace (superseded: / revise:) — ERR_RESERVED_EVENT_ID", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", sessionId: "S1", now: new Date(ISO) });
  // "superseded:" — projector synthetic-replacement namespace.
  await assert.rejects(
    () => commitAttemptEvent({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 0,
      event: { type: "define_activation", requestId: "superseded:keep", fields: { activationDefinition: "x" }, at: ISO },
    }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_RESERVED_EVENT_ID",
  );
  // "revise:" — deterministic supersede-command namespace. A normal commit here would
  // make a later legitimate supersede falsely dedupe and skip its guards.
  const collidingId = supersedeCommandId("a1", "def-evt", { type: "define_activation", fields: { activationDefinition: "y" } });
  assert.ok(collidingId.startsWith("revise:"));
  await assert.rejects(
    () => commitAttemptEvent({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 0,
      event: { type: "define_activation", requestId: collidingId, fields: { activationDefinition: "x" }, at: ISO },
    }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_RESERVED_EVENT_ID",
  );
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.events.length, 0, "nothing committed under a reserved requestId");
});

test("supersedeAnswer: cardType/target mismatch throws ERR_SUPERSEDE_BAD_TARGET", async () => {
  const ws = await makeWorkspace();
  await seedCandidate(ws);
  // r1 is a define_activation, but we claim card candidate_selection.
  await assert.rejects(
    () => supersedeAnswer({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 2,
      targetEventId: "r1", cardType: "candidate_selection",
      replacement: { type: "select_candidate", fields: { candidate: "박조은" }, at: ISO },
      now: new Date(ISO),
    }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_SUPERSEDE_BAD_TARGET",
  );
});

test("supersedeAnswer: cancels the dropped downstream event's pending/posted deliveries (P0-4)", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", sessionId: "S1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  // candidate r2 carries a delivery; mark it posted (a live, not-yet-consumed response).
  await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 1, event: candidateEvent("r2", "조은성"),
    responsePayload: { card: "current_alternative" },
  });
  await markPosted({ workspaceRoot: ws, attemptId: "a1", eventId: "r2" });
  let pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].eventId, "r2");

  // Supersede r2 → its dropped delivery must be canceled (no longer a re-post target).
  await supersedeAnswer({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 2,
    targetEventId: "r2", cardType: "candidate_selection",
    replacement: { type: "select_candidate", fields: { candidate: "박조은" }, at: ISO },
    now: new Date(ISO),
  });
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.deliveries.r2.status, "canceled");
  pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(pending.length, 0, "the superseded downstream delivery is no longer a re-post target");
});

// ── determinism ───────────────────────────────────────────────────────────────
test("determinism: projecting the same events twice yields deep-equal results", async () => {
  const events = [
    { type: "define_activation", eventId: "e0", fields: { activationDefinition: "runs flow" }, at: ISO },
    { type: "select_candidate", eventId: "e1", fields: { candidate: "조은성" }, at: ISO },
    { type: "record_alternative", eventId: "e2", fields: { currentAlternative: "spreadsheet" }, at: ISO },
  ];
  const a = projectAttemptFromEvents(events, { id: "a1", goalLane: "get_users", createdAt: ISO });
  const b = projectAttemptFromEvents(events, { id: "a1", goalLane: "get_users", createdAt: ISO });
  assert.deepEqual(a, b);
  assert.equal(a.status, "needs_action_contract");
});

// ── assertSameCommandPayload unit ─────────────────────────────────────────────
test("assertSameCommandPayload: same type+fields+audit (different at) is OK; different fields or audit throws", () => {
  const prior = { type: "define_activation", fields: { activationDefinition: "x" }, audit: { responseText: "a" }, at: "T1" };
  // same type+fields+audit, different at → no throw
  assert.doesNotThrow(() => assertSameCommandPayload(prior, { type: "define_activation", fields: { activationDefinition: "x" }, audit: { responseText: "a" }, at: "T2" }));
  // different fields → throws
  assert.throws(
    () => assertSameCommandPayload(prior, { type: "define_activation", fields: { activationDefinition: "y" }, audit: { responseText: "a" }, at: "T1" }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_EVENT_ID_CONFLICT",
  );
  // different audit → throws
  assert.throws(
    () => assertSameCommandPayload(prior, { type: "define_activation", fields: { activationDefinition: "x" }, audit: { responseText: "DIFFERENT" }, at: "T1" }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_EVENT_ID_CONFLICT",
  );
  // different type → throws
  assert.throws(
    () => assertSameCommandPayload(prior, { type: "select_candidate", fields: { activationDefinition: "x" }, audit: { responseText: "a" }, at: "T1" }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_EVENT_ID_CONFLICT",
  );
});

// ── commit guards ─────────────────────────────────────────────────────────────
test("commit: missing requestId throws ERR_NO_REQUEST_ID", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await assert.rejects(
    () => commitAttemptEvent({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 0,
      event: { type: "define_activation", fields: { activationDefinition: "x" }, at: ISO },
    }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_NO_REQUEST_ID",
  );
});

test("commit: an illegal transition is fail-closed (projector throws)", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  // select_candidate is illegal from needs_definition.
  await assert.rejects(
    () => commitAttemptEvent({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 0,
      event: candidateEvent("r1", "조은성"),
    }),
    (err) => err && err.code === "ERR_ILLEGAL_FROM",
  );
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.revision, 0);
  assert.equal(log.attempts.a1.events.length, 0);
});

test("commit: a bad dueAt is fail-closed (projector throws ERR_INVALID_DUE_AT) (P0/H)", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", sessionId: "S1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 1, event: candidateEvent("r2", "조은성") });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 2, event: { type: "record_alternative", requestId: "r3", fields: { currentAlternative: "spreadsheet" }, at: ISO } });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 3, event: { type: "define_action_contract", requestId: "r4", fields: { externalAction: "send DM", attemptThreshold: "1", successCondition: "tries it" }, at: ISO } });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 4, event: { type: "define_evidence_contract", requestId: "r5", fields: { expectedProofKind: "dm_sent_screenshot", evidenceLocation: "cap" }, at: ISO } });
  // A PAST dueAt (before the event.at) → rejected.
  await assert.rejects(
    () => commitAttemptEvent({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 5,
      event: { type: "schedule_execution", requestId: "r6", fields: { dueAt: "2026-06-23T00:00:00.000Z" }, at: ISO },
    }),
    (err) => err && err.code === "ERR_INVALID_DUE_AT",
  );
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.revision, 5, "nothing written on a bad-dueAt schedule");
});

test("commit: a non-existent attempt throws ERR_ATTEMPT_NOT_FOUND", async () => {
  const ws = await makeWorkspace();
  await assert.rejects(
    () => commitAttemptEvent({ workspaceRoot: ws, attemptId: "missing", expectedRevision: 0, event: activationEvent("r1") }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_ATTEMPT_NOT_FOUND",
  );
});

// ── cardDefinition additive export ────────────────────────────────────────────
test("cardDefinition returns the frozen card def or null", () => {
  const def = cardDefinition("action_request");
  assert.equal(def.forState, "needs_action_contract");
  assert.equal(def.legacySignalId, "get_users_today_request");
  assert.equal(cardDefinition("nope"), null);
  assert.equal(cardDefinition(""), null);
});

// ── projectAttempt snapshot shape (GPT R1.b F) ────────────────────────────────
test("projectAttempt returns { projection, revision, record, effectiveEvents } with revision == events.length", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 1, event: candidateEvent("r2", "조은성") });
  const snap = await projectAttempt({ workspaceRoot: ws, attemptId: "a1" });
  assert.ok(snap.projection && typeof snap.projection === "object");
  assert.equal(snap.revision, 2);
  assert.equal(snap.revision, snap.record.events.length, "revision tracks the raw event count");
  assert.ok(Array.isArray(snap.effectiveEvents));
  assert.equal(snap.effectiveEvents.length, 2, "no supersede → effective == raw");
  assert.equal(snap.projection.status, "needs_alternative");
});

test("projectAttempt returns null for an unknown attemptId", async () => {
  const ws = await makeWorkspace();
  const snap = await projectAttempt({ workspaceRoot: ws, attemptId: "ghost" });
  assert.equal(snap, null);
});

// re-verify R4 #1: commitAttemptEvent must NOT persist a control event (answer_superseded)
// out-of-band — that would bypass every supersede guard and corrupt the branch.
test("commitAttemptEvent: rejects an answer_superseded control event — ERR_CONTROL_EVENT_VIA_COMMIT", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", sessionId: "S1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("e1"), responsePayload: { ok: 1 } });
  await assert.rejects(
    () => commitAttemptEvent({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 1,
      event: { type: "answer_superseded", requestId: "rogue", fields: { targetEventId: "e1", replacement: { type: "define_activation", fields: { activationDefinition: "Y" }, at: ISO } }, at: ISO },
    }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_CONTROL_EVENT_VIA_COMMIT",
  );
  const snap = await projectAttempt({ workspaceRoot: ws, attemptId: "a1" });
  assert.equal(snap.revision, 1, "the rogue control event was not appended");
});

// re-verify R4 #2: re-committing (idempotency re-queue) an event a supersede has
// REVERTED must NOT inject a stale pending delivery into the re-post set.
test("commitAttemptEvent: re-queue is gated on effective-branch membership (no stale delivery for a reverted event)", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", sessionId: "S1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("rA"), responsePayload: { A: 1 } });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 1, event: candidateEvent("rB", "조은성") }); // no payload → no delivery
  // supersede the activation rA → drops rA + downstream rB from the effective branch.
  await supersedeAnswer({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 2,
    targetEventId: "rA", cardType: "activation_definition",
    replacement: { type: "define_activation", fields: { activationDefinition: "redefined" }, at: ISO },
    now: new Date(ISO),
  });
  const mid = await projectAttempt({ workspaceRoot: ws, attemptId: "a1" });
  assert.equal(mid.projection.status, "needs_candidate"); // rB reverted
  // Now re-commit rB WITH a payload (idempotent: rB event already exists). It must
  // NOT fabricate a pending delivery, because rB is no longer in the effective branch.
  const res = await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: mid.revision, event: { ...candidateEvent("rB", "조은성"), audit: candidateEvent("rB", "조은성").audit }, responsePayload: { B: 1 } });
  assert.equal(res.applied, false);
  const pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.ok(!pending.some((d) => d.eventId === "rB"), "no stale delivery re-queued for the reverted event rB");
});

// re-verify R4 #3: a supersede's own confirmation delivery is re-queued on a
// deterministic-id retry-with-payload (CP2 parity with commitAttemptEvent).
test("supersedeAnswer: idempotent retry re-queues a missing supersede delivery (CP2 parity)", async () => {
  const ws = await makeWorkspace();
  await seedCandidate(ws); // activation r1, candidate r2, rev 2
  const replacement = { type: "select_candidate", fields: { candidate: "박조은" }, at: ISO };
  // First supersede WITHOUT a responsePayload → no delivery.
  const first = await supersedeAnswer({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 2,
    targetEventId: "r2", cardType: "candidate_selection", replacement, now: new Date(ISO),
  });
  assert.equal(first.applied, true);
  let pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.ok(!pending.some((d) => d.eventId === first.eventId), "no delivery yet (first call had no payload)");
  // Retry the SAME supersede WITH a responsePayload → idempotent (no double-append) but
  // the confirmation delivery is now re-queued.
  const retry = await supersedeAnswer({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 2,
    targetEventId: "r2", cardType: "candidate_selection", replacement,
    responsePayload: { confirm: "candidate updated to 박조은" }, now: new Date(ISO),
  });
  assert.equal(retry.applied, false);
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.events.length, 3, "no double append");
  pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.ok(pending.some((d) => d.eventId === first.eventId), "the supersede confirmation delivery was re-queued on retry");
});

// re-verify R4 low(a): a non-canonical delivery status fails the loader closed.
test("strict loader: a delivery with a non-canonical status THROWS (no silent loss)", async () => {
  const ws = await makeWorkspace();
  await writeRawLog(ws, {
    schemaVersion: OFFICE_HOURS_ATTEMPTS_SCHEMA_VERSION, schema: OFFICE_HOURS_ATTEMPTS_SCHEMA, updatedAt: ISO,
    attempts: { a1: { attemptId: "a1", goalLane: "get_users", revision: 1, createdAt: ISO, updatedAt: ISO, events: [{ eventId: "e1", type: "define_activation", fields: { activationDefinition: "x" }, at: ISO }], deliveries: { e1: { requestId: "e1", responsePayload: { ok: 1 }, status: "delivered" } } } },
  });
  await assert.rejects(
    () => loadAttemptLog({ workspaceRoot: ws }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_ATTEMPT_LOG_SCHEMA",
  );
});

// hole 2 (adversarial-verify): a later supersede that drops an EARLIER supersede's
// replacement must also cancel that earlier supersede's OWN client delivery. The
// dropped replacement carries a synthetic "superseded:<directiveId>" id, but its
// delivery is keyed by the bare <directiveId> ("revise:..."); without mapping the
// synthetic id back, the stale confirmation would linger in pendingDeliveries and
// re-post a now-reverted revision after a crash.
test("supersedeAnswer: a later supersede cancels a dropped earlier supersede's own delivery (hole-2)", async () => {
  const ws = await makeWorkspace();
  await seedCandidate(ws); // activation(r1), candidate(r2=조은성), rev 2
  const repl1 = { type: "select_candidate", fields: { candidate: "박조은" }, at: ISO };
  const s1 = await supersedeAnswer({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 2,
    targetEventId: "r2", cardType: "candidate_selection", replacement: repl1,
    responsePayload: { sessionId: "S1", requestId: "x", note: "candidate→박조은 confirmed" },
    now: new Date(ISO),
  });
  assert.equal(s1.applied, true);
  const s1DeliveryId = supersedeCommandId("a1", "r2", repl1); // == "revise:a1:r2:<hash>"
  await markPosted({ workspaceRoot: ws, attemptId: "a1", eventId: s1DeliveryId });
  // S1's delivery is a live re-post target right now.
  let pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.ok(pending.some((d) => d.eventId === s1DeliveryId), "S1 confirmation is pending/posted before S2");

  // S2 supersedes the ACTIVATION (before S1's candidate replacement), dropping the
  // whole branch from the activation onward — including S1's replacement.
  const s2 = await supersedeAnswer({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: s1.revision,
    targetEventId: "r1", cardType: "activation_definition", replacement: { type: "define_activation", fields: { activationDefinition: "redefined activation" }, at: ISO },
    now: new Date(ISO),
  });
  assert.equal(s2.applied, true);

  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.deliveries[s1DeliveryId].status, "canceled", "S1's own delivery was canceled by S2");
  pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.ok(!pending.some((d) => d.eventId === s1DeliveryId), "the dropped S1 confirmation no longer re-posts");
});

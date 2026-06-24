// Crash / restart / concurrency / idempotency / migration harness for the
// Office Hours attempt store (R1.a infra-only). Crashes are simulated by writing
// intermediate-state files and doing a fresh load + replay — deterministic, no
// real process kills (the store is pure-function + file based).

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
  projectAttempt,
  projectAttemptFromEvents,
  markDelivered,
  pendingDeliveries,
  assertSameCommandPayload,
  withAttemptLeaseLock,
} from "../sidecar/office-hours-attempt-store.mjs";

import {
  buildOfficeHoursMigrationPlan,
  cardDefinition,
  ValidationAttemptMigrationError,
  LEGACY_MIGRATION_DISPOSITION_UNVERIFIED,
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
  // a1 is in needs_definition (unresolved) → a new attempt must be blocked.
  await assert.rejects(
    () => startAttempt({ workspaceRoot: ws, attemptId: "a2", now: new Date(ISO) }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_ATTEMPT_ALREADY_OPEN",
  );
});

test("startAttempt allows a new attempt once the prior one is resolved (terminal)", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  // Drive a1 to a terminal state via abandon_attempt.
  await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0,
    event: { type: "abandon_attempt", requestId: "r-abandon", fields: { abandonReason: "scope cut" }, at: ISO },
  });
  const proj = await projectAttempt({ workspaceRoot: ws, attemptId: "a1" });
  assert.equal(proj.status, "failed");
  // Now a2 may start.
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
  // Immutable audit is persisted on the raw event.
  assert.equal(log.attempts.a1.events[0].audit.responseText, "runs core flow");
  assert.equal(log.attempts.a1.events[0].requestId, "r1");
  assert.equal(log.attempts.a1.events[0].eventId, "r1");
});

// ── idempotency BEFORE CAS (GPT#1) ────────────────────────────────────────────
test("idempotency-before-CAS: same requestId + same payload with STALE expectedRevision returns applied:false (not a CAS error)", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  // Retry with a STALE expectedRevision (0, but store is at 1). Must NOT throw a
  // CAS conflict — the eventId is already present, so idempotency wins.
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

// ── CAS conflict ──────────────────────────────────────────────────────────────
test("CAS: a first-seen event with a stale expectedRevision throws ERR_ATTEMPT_REVISION_CONFLICT", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  // New event (r2) but expectedRevision is stale (0; store at 1).
  await assert.rejects(
    () => commitAttemptEvent({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 0,
      event: { type: "select_candidate", requestId: "r2", fields: { candidate: "조은성" }, at: ISO },
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

// ── durable outbox (GPT#2) ────────────────────────────────────────────────────
test("outbox: a commit with responsePayload records a pending delivery; pendingDeliveries lists it; markDelivered flips it", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1"),
    responsePayload: { ok: true, card: "candidate_selection" },
  });
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.deliveries.r1.status, "pending");
  assert.deepEqual(log.attempts.a1.deliveries.r1.responsePayload, { ok: true, card: "candidate_selection" });

  let pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].attemptId, "a1");
  assert.equal(pending[0].eventId, "r1");

  const flip = await markDelivered({ workspaceRoot: ws, attemptId: "a1", eventId: "r1" });
  assert.equal(flip.status, "delivered");
  pending = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(pending.length, 0);
});

test("outbox re-post: crash after commit but before markDelivered → pending still visible on fresh load, re-post is idempotent", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1"),
    responsePayload: { ok: true },
  });
  // "Crash" = no markDelivered call. Fresh load (restart) still sees pending.
  const pendingAfterCrash = await pendingDeliveries({ workspaceRoot: ws });
  assert.equal(pendingAfterCrash.length, 1);
  // Re-post the same command (idempotent) — must not duplicate the event, must
  // keep the delivery pending.
  const retry = await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 1, event: activationEvent("r1"),
    responsePayload: { ok: true },
  });
  assert.equal(retry.applied, false);
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.events.length, 1);
  assert.equal(log.attempts.a1.deliveries.r1.status, "pending");
});

test("markDelivered is idempotent (already delivered → applied:false)", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1"),
    responsePayload: { ok: true },
  });
  await markDelivered({ workspaceRoot: ws, attemptId: "a1", eventId: "r1" });
  const second = await markDelivered({ workspaceRoot: ws, attemptId: "a1", eventId: "r1" });
  assert.equal(second.applied, false);
  assert.equal(second.status, "delivered");
});

// ── CP1: commit appended, projection consumer crashed before reading ──────────
test("CP1 (crash after event append, before downstream): events[] alone reproject identically; resubmit is applied:false", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  const committed = await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1"),
  });
  // Fresh load + replay (== restart): projection is identical to the commit's.
  const reprojected = await projectAttempt({ workspaceRoot: ws, attemptId: "a1" });
  assert.deepEqual(reprojected, committed.projection);
  // Resubmit the same command → idempotent.
  const resubmit = await commitAttemptEvent({
    workspaceRoot: ws, attemptId: "a1", expectedRevision: 1, event: activationEvent("r1"),
  });
  assert.equal(resubmit.applied, false);
});

// ── CP2: event appended, response write was lost ──────────────────────────────
test("CP2 (event appended, response write lost): re-commit with responsePayload re-queues a pending delivery", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  // First commit WITHOUT responsePayload (simulating: event landed, response
  // write never happened).
  await commitAttemptEvent({ workspaceRoot: ws, attemptId: "a1", expectedRevision: 0, event: activationEvent("r1") });
  let log = await readRawLog(ws);
  assert.equal(log.attempts.a1.deliveries.r1, undefined, "no delivery yet");
  // Restart + re-post the same command, this time carrying the responsePayload.
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
    event: { type: "select_candidate", requestId: "r2", fields: { candidate: "조은성" }, at: ISO, sessionId: "SESSION-B" },
  });
  const projAB = await projectAttempt({ workspaceRoot: wsAB, attemptId: "a1" });

  // Same events but with sessionId swapped on every event → identical projection.
  const wsBA = await makeWorkspace();
  await startAttempt({ workspaceRoot: wsBA, attemptId: "a1", sessionId: "SESSION-B", now: new Date(ISO) });
  await commitAttemptEvent({
    workspaceRoot: wsBA, attemptId: "a1", expectedRevision: 0,
    event: activationEvent("r1", { sessionId: "SESSION-B" }),
  });
  await commitAttemptEvent({
    workspaceRoot: wsBA, attemptId: "a1", expectedRevision: 1,
    event: { type: "select_candidate", requestId: "r2", fields: { candidate: "조은성" }, at: ISO, sessionId: "SESSION-A" },
  });
  const projBA = await projectAttempt({ workspaceRoot: wsBA, attemptId: "a1" });

  assert.deepEqual(projAB, projBA, "projection is independent of which session committed which event");
  assert.equal(projAB.status, "needs_alternative");
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

// ── lease lock (no-steal / no foreign unlink) ─────────────────────────────────
test("lease lock: an unexpired foreign lock is NOT stolen", async () => {
  const ws = await makeWorkspace();
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot: ws });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // Plant a fresh foreign lock (someone else owns it, not expired).
  const lockPath = `${filePath}.lock`;
  await fs.writeFile(lockPath, JSON.stringify({ owner: "OTHER-WRITER", at: new Date().toISOString() }));

  // Our lock attempt must time out quickly rather than steal the live lock. The
  // lease expiry is kept long (so the fresh foreign lock is never "expired"); the
  // acquisition budget is short so the call returns promptly.
  await assert.rejects(
    () => withAttemptLeaseLock(filePath, async () => "should-not-run", { timeoutMs: 30_000, acquireTimeoutMs: 120, pollMs: 20 }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_ATTEMPT_LOCK_TIMEOUT",
  );
  // The foreign lock is untouched.
  const after = JSON.parse(await fs.readFile(lockPath, "utf8"));
  assert.equal(after.owner, "OTHER-WRITER", "foreign lock must not be unlinked on release");
});

test("lease lock: an EXPIRED foreign lock IS stolen", async () => {
  const ws = await makeWorkspace();
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot: ws });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  await fs.writeFile(lockPath, JSON.stringify({ owner: "DEAD-WRITER", at: "2000-01-01T00:00:00.000Z" }));
  // Backdate mtime so the lease is clearly expired.
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lockPath, old, old);

  const ran = await withAttemptLeaseLock(filePath, async () => "stolen-ok", { timeoutMs: 5_000, pollMs: 20 });
  assert.equal(ran, "stolen-ok");
  // After release, the lock is gone (we owned it).
  await assert.rejects(() => fs.stat(lockPath), (err) => err.code === "ENOENT");
});

test("lease lock: release does not unlink a lock another writer now owns", async () => {
  const ws = await makeWorkspace();
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot: ws });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;

  // Hold the lock, and DURING the critical section overwrite the lock with a
  // foreign owner (simulating a steal). Our finally must NOT unlink it.
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
  // Read raw bytes and parse — must not throw.
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot: ws });
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.attempts.a1.revision, 1);
  // No stray temp files left behind in the memory dir.
  const dirEntries = await fs.readdir(path.dirname(filePath));
  assert.ok(!dirEntries.some((e) => e.endsWith(".tmp")), "no temp files remain after a durable write");
});

// ── projector control events ──────────────────────────────────────────────────
test("projector: legacy_imported applies recoverable fields / hints / disposition WITHOUT a reducer transition", async () => {
  const events = [
    { type: "define_activation", eventId: "e0", fields: { activationDefinition: "runs flow" }, at: ISO },
    {
      type: "legacy_imported", eventId: "e1",
      fields: {
        recoverableFields: { candidate: "조은성" },
        migrationHints: { externalAction: "send DM" },
        migrationDisposition: LEGACY_MIGRATION_DISPOSITION_UNVERIFIED,
      },
      at: ISO,
    },
  ];
  const proj = projectAttemptFromEvents(events, { id: "a1", goalLane: "get_users", createdAt: ISO });
  // define_activation moved status to needs_candidate; legacy_imported patched
  // candidate + hints + disposition without throwing ERR_UNKNOWN_TRANSITION.
  assert.equal(proj.status, "needs_candidate");
  assert.equal(proj.candidate, "조은성");
  assert.deepEqual(proj.migrationHints, { externalAction: "send DM" });
  assert.equal(proj.migrationDisposition, LEGACY_MIGRATION_DISPOSITION_UNVERIFIED);
});

test("projector: answer_superseded replays the branch before targetEventId, drops superseded downstream, applies replacement; raw events preserved", async () => {
  // Original branch: define_activation(e0) → select_candidate(e1, '조은성').
  // Then the candidate answer (e1) is superseded with a different candidate.
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
  // Effective branch = e0 + replacement(select_candidate '박조은'); e1 dropped.
  assert.equal(proj.candidate, "박조은", "replacement candidate wins");
  assert.equal(proj.status, "needs_alternative", "advanced past the (replaced) candidate slot");
  // Raw events are NOT physically truncated — they are inputs to the projector.
  assert.equal(rawEvents.length, 3, "raw events preserved (logical, not physical, replacement)");
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

// ── migration plan (GPT#4) ────────────────────────────────────────────────────
test("migration plan: clean 3-slot + action_request → replay reproject is needs_action_contract + unverified disposition", async () => {
  const turns = [
    { signalId: "get_users_active_user_definition", responseText: "user runs core flow once" },
    { signalId: "get_users_first_candidate", responseText: "조은성" },
    { signalId: "get_users_current_alternative", responseText: "manual spreadsheet" },
    { signalId: "get_users_today_request", responseText: "send a DM asking to try" },
  ];
  const plan = buildOfficeHoursMigrationPlan(turns, { id: "a1", createdAt: ISO });
  assert.deepEqual(plan.events.map((e) => e.type),
    ["define_activation", "select_candidate", "record_alternative", "legacy_imported"]);
  assert.equal(plan.migrationMetadata.disposition, LEGACY_MIGRATION_DISPOSITION_UNVERIFIED);

  const proj = projectAttemptFromEvents(plan.events, { id: "a1", goalLane: "get_users", createdAt: ISO });
  assert.equal(proj.status, "needs_action_contract");
  assert.equal(proj.externalAction, "send a DM asking to try");
  assert.equal(proj.migrationDisposition, LEGACY_MIGRATION_DISPOSITION_UNVERIFIED);
});

test("migration plan: clean 3-slot WITHOUT action_request → stops at needs_action_contract, no disposition tag", async () => {
  const turns = [
    { signalId: "get_users_active_user_definition", responseText: "runs core flow" },
    { signalId: "get_users_first_candidate", responseText: "조은성" },
    { signalId: "get_users_current_alternative", responseText: "spreadsheet" },
  ];
  const plan = buildOfficeHoursMigrationPlan(turns, { id: "a1", createdAt: ISO });
  assert.deepEqual(plan.events.map((e) => e.type), ["define_activation", "select_candidate", "record_alternative"]);
  assert.equal(plan.migrationMetadata.disposition, "");
  const proj = projectAttemptFromEvents(plan.events, { id: "a1", createdAt: ISO });
  assert.equal(proj.status, "needs_action_contract");
});

test("migration plan: ambiguity (same slot, two differing texts) throws ERR_MIGRATION_AMBIGUOUS", async () => {
  const turns = [
    { signalId: "get_users_active_user_definition", responseText: "definition one" },
    { signalId: "get_users_active_user_definition", responseText: "definition two" },
  ];
  assert.throws(
    () => buildOfficeHoursMigrationPlan(turns, { id: "a1", createdAt: ISO }),
    (err) => err instanceof ValidationAttemptMigrationError && err.code === "ERR_MIGRATION_AMBIGUOUS",
  );
});

test("migration plan: ambiguity (ladder gap) throws ERR_MIGRATION_AMBIGUOUS", async () => {
  const turns = [
    { signalId: "get_users_active_user_definition", responseText: "runs flow" },
    // skip first_candidate → current_alternative present while candidate missing
    { signalId: "get_users_current_alternative", responseText: "spreadsheet" },
  ];
  assert.throws(
    () => buildOfficeHoursMigrationPlan(turns, { id: "a1", createdAt: ISO }),
    (err) => err instanceof ValidationAttemptMigrationError && err.code === "ERR_MIGRATION_AMBIGUOUS",
  );
});

test("migration plan: ambiguity (unrecognized signalId) throws ERR_MIGRATION_AMBIGUOUS", async () => {
  const turns = [
    { signalId: "get_users_active_user_definition", responseText: "runs flow" },
    { signalId: "totally_unknown_signal", responseText: "noise" },
  ];
  assert.throws(
    () => buildOfficeHoursMigrationPlan(turns, { id: "a1", createdAt: ISO }),
    (err) => err instanceof ValidationAttemptMigrationError && err.code === "ERR_MIGRATION_AMBIGUOUS",
  );
});

test("migration plan: NO fabrication — events contain no dueAt / threshold / success / 'legacy' placeholders", async () => {
  const turns = [
    { signalId: "get_users_active_user_definition", responseText: "runs core flow once" },
    { signalId: "get_users_first_candidate", responseText: "조은성" },
    { signalId: "get_users_current_alternative", responseText: "spreadsheet" },
    { signalId: "get_users_today_request", responseText: "send a DM" },
  ];
  const plan = buildOfficeHoursMigrationPlan(turns, { id: "a1", createdAt: ISO });
  const json = JSON.stringify(plan.events);
  assert.ok(!/\bdueAt\b/.test(json), "no fabricated dueAt");
  assert.ok(!/\battemptThreshold\b/.test(json), "no fabricated attemptThreshold");
  assert.ok(!/\bsuccessCondition\b/.test(json), "no fabricated successCondition");
  // No literal fabricated placeholder values like the bare strings "legacy"/"1".
  for (const ev of plan.events) {
    if (ev.type === "define_action_contract") {
      assert.fail("must NOT emit define_action_contract from a single legacy text");
    }
  }
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
test("assertSameCommandPayload: same type+fields (different at) is OK; different fields throws", () => {
  const prior = { type: "define_activation", fields: { activationDefinition: "x" }, at: "T1" };
  // same type+fields, different at → no throw
  assert.doesNotThrow(() => assertSameCommandPayload(prior, { type: "define_activation", fields: { activationDefinition: "x" }, at: "T2" }));
  // different fields → throws
  assert.throws(
    () => assertSameCommandPayload(prior, { type: "define_activation", fields: { activationDefinition: "y" }, at: "T1" }),
    (err) => err instanceof AttemptStoreError && err.code === "ERR_EVENT_ID_CONFLICT",
  );
  // different type → throws
  assert.throws(
    () => assertSameCommandPayload(prior, { type: "select_candidate", fields: { activationDefinition: "x" }, at: "T1" }),
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

test("commit: an illegal transition is fail-closed (reducer throws)", async () => {
  const ws = await makeWorkspace();
  await startAttempt({ workspaceRoot: ws, attemptId: "a1", now: new Date(ISO) });
  // select_candidate is illegal from needs_definition.
  await assert.rejects(
    () => commitAttemptEvent({
      workspaceRoot: ws, attemptId: "a1", expectedRevision: 0,
      event: { type: "select_candidate", requestId: "r1", fields: { candidate: "조은성" }, at: ISO },
    }),
    (err) => err && err.code === "ERR_ILLEGAL_FROM",
  );
  // Nothing was written (still revision 0).
  const log = await readRawLog(ws);
  assert.equal(log.attempts.a1.revision, 0);
  assert.equal(log.attempts.a1.events.length, 0);
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

// ── projectAttempt for an unknown attempt ─────────────────────────────────────
test("projectAttempt returns null for an unknown attemptId", async () => {
  const ws = await makeWorkspace();
  const proj = await projectAttempt({ workspaceRoot: ws, attemptId: "ghost" });
  assert.equal(proj, null);
});

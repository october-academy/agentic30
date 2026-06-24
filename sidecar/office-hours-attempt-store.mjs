// office-hours-attempt-store.mjs — durable, crash-safe event store for the
// Office Hours ValidationAttempt lifecycle (R1.a, infra-only — NOT wired into
// index.mjs; blast-radius-0 per the GPT-5.5 Pro R1 review).
//
// What this module is: the single writer + reader for the per-workspace
// office-hours-attempts.json event log. It owns durability (fsync + dir-sync),
// concurrency (owner-token lease lock), idempotency (eventId == requestId,
// checked BEFORE the CAS revision check), a durable outbox (deliveries[] for
// restart re-post), and a projector that replays raw events through the pure
// contract reducer (reduceValidationAttempt) plus two store-level control events
// the reducer does not know about (legacy_imported, answer_superseded).
//
// What this module is NOT: it does not advance state itself, does not call the
// LLM, and is not referenced by the running daemon. State authority stays in
// office-hours-contract.mjs; this file only persists and replays the events that
// drive it.
//
// Design constraints (spec §제약):
//   - All I/O is confined to THIS module. The only non-stdlib imports are the
//     pure contract module and atomic-store. We deliberately do NOT route the
//     authoritative commit write through atomic-store.atomicWriteJson because it
//     lacks fsync + directory-sync; we implement a durable writer here instead.
//   - No feature flags, no silent fallbacks. Every failure throws a coded Error.
//   - The migration plan NEVER fabricates dueAt/threshold/successCondition.

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Imported per the spec's allowance (atomic-store is the only permitted sibling
// dependency besides the pure contract). The store's authoritative writes use the
// durable writer below — atomicWriteJson lacks fsync + dir-sync — but importing it
// documents the sanctioned dependency surface and lets callers reuse it later.
// eslint-disable-next-line no-unused-vars
import { atomicWriteJson } from "./atomic-store.mjs";
import {
  createValidationAttempt,
  reduceValidationAttempt,
  canStartNewAttempt,
  stableStringify,
} from "./office-hours-contract.mjs";

export const OFFICE_HOURS_ATTEMPTS_SCHEMA_VERSION = 1;
export const OFFICE_HOURS_ATTEMPTS_SCHEMA = "agentic30.memory.office_hours_attempts.v1";

// Lease timeout: large enough that a slow replay/write under contention does not
// get its lock stolen, but finite so a crashed writer eventually frees the file.
// The acquisition budget (how long WE wait to take the lock) is separate from the
// lease expiry (how stale a foreign lock must be before it may be stolen) so a
// short wait can never accidentally classify a live foreign lock as expired.
const DEFAULT_LEASE_TIMEOUT_MS = 30_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_LEASE_POLL_MS = 25;

// ── Coded error ──────────────────────────────────────────────────────────────
export class AttemptStoreError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AttemptStoreError";
    this.code = code || "ERR_ATTEMPT_STORE";
  }
}

// ── Path resolution (mirrors workspace-memory's resolver; kept local so the
// store does not depend on workspace-memory and stays I/O-self-contained). ─────
export function resolveOfficeHoursAttemptLogPath({ workspaceRoot } = {}) {
  if (!workspaceRoot) {
    throw new AttemptStoreError("workspaceRoot is required", "ERR_NO_WORKSPACE");
  }
  return path.join(path.resolve(String(workspaceRoot)), ".agentic30", "memory", "office-hours-attempts.json");
}

// ── Strict loader (spec §loadAttemptLog; GPT#4 — fail-CLOSED) ─────────────────
// Absent file → empty log. Any read/parse error or schemaVersion mismatch THROWS
// (the exact opposite of loadOfficeHoursTurnLog's fail-open catch).
export async function loadAttemptLog({ workspaceRoot } = {}) {
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot });
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return emptyAttemptLog();
    }
    throw new AttemptStoreError(
      `failed to read attempt log at ${filePath}: ${err && err.message}`,
      "ERR_ATTEMPT_LOG_READ",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AttemptStoreError(
      `attempt log is not valid JSON at ${filePath}: ${err && err.message}`,
      "ERR_ATTEMPT_LOG_PARSE",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AttemptStoreError(
      `attempt log root must be an object at ${filePath}`,
      "ERR_ATTEMPT_LOG_PARSE",
    );
  }
  if (parsed.schemaVersion !== OFFICE_HOURS_ATTEMPTS_SCHEMA_VERSION) {
    throw new AttemptStoreError(
      `attempt log schemaVersion ${String(parsed.schemaVersion)} != ${OFFICE_HOURS_ATTEMPTS_SCHEMA_VERSION}`,
      "ERR_ATTEMPT_LOG_SCHEMA",
    );
  }
  if (!parsed.attempts || typeof parsed.attempts !== "object" || Array.isArray(parsed.attempts)) {
    throw new AttemptStoreError(
      `attempt log "attempts" must be an object at ${filePath}`,
      "ERR_ATTEMPT_LOG_PARSE",
    );
  }
  return parsed;
}

function emptyAttemptLog() {
  return {
    schemaVersion: OFFICE_HOURS_ATTEMPTS_SCHEMA_VERSION,
    schema: OFFICE_HOURS_ATTEMPTS_SCHEMA,
    updatedAt: "",
    attempts: {},
  };
}

// ── Durable writer (spec §durable atomic write; GPT#7) ────────────────────────
// temp write → FileHandle.sync() (fsync the file bytes) → rename → directory
// fsync (so the rename itself is durable). atomic-store.atomicWriteJson omits the
// fsync steps, which is why the store implements its own writer here.
async function durableWriteJson(filePath, payload) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.${randomUUID()}.tmp`);
  await fs.mkdir(dir, { recursive: true });

  let fh;
  try {
    fh = await fs.open(tempPath, "w", 0o600);
    await fh.writeFile(JSON.stringify(payload, null, 2));
    await fh.sync(); // fsync the file contents before exposing it via rename
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
  try {
    await fs.rename(tempPath, filePath);
  } catch (err) {
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
  // fsync the directory so the rename (a metadata op) is itself durable.
  await fsyncDir(dir);
}

async function fsyncDir(dir) {
  let dh;
  try {
    dh = await fs.open(dir, "r");
    await dh.sync();
  } catch {
    // Some platforms (notably Windows) reject opening a directory for fsync.
    // The rename above is still atomic; we degrade the durability guarantee on
    // those platforms rather than throwing. On POSIX (our target) this succeeds.
  } finally {
    if (dh) await dh.close().catch(() => {});
  }
}

// ── Owner-token lease lock (spec §withAttemptLeaseLock) ───────────────────────
// O_EXCL create wins the lock and writes {owner, at}. A held lock is only stolen
// if it is NOT ours AND its lease has expired (mtime older than timeout). The
// finally only unlinks when the lockfile still carries OUR token — we never
// delete a lock another writer legitimately holds or stole.
export async function withAttemptLeaseLock(
  filePath,
  fn,
  {
    timeoutMs = DEFAULT_LEASE_TIMEOUT_MS, // lease expiry — when a foreign lock may be stolen
    acquireTimeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS, // how long WE wait to acquire
    pollMs = DEFAULT_LEASE_POLL_MS,
  } = {},
) {
  const lockPath = `${filePath}.lock`;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const start = Date.now();

  while (true) {
    let acquired = false;
    try {
      const fh = await fs.open(lockPath, "wx", 0o600);
      try {
        await fh.writeFile(JSON.stringify({ owner: token, at: new Date().toISOString() }));
        await fh.sync().catch(() => {});
      } finally {
        await fh.close().catch(() => {});
      }
      acquired = true;
    } catch (err) {
      if (!err || err.code !== "EEXIST") throw err;
    }

    if (acquired) break;

    // Lock is held by someone. Only steal it if it is NOT ours and expired.
    let stat;
    try {
      stat = await fs.stat(lockPath);
    } catch {
      continue; // lock vanished between EEXIST and stat — retry create
    }
    const existing = await readLockOwner(lockPath);
    const expired = Date.now() - stat.mtimeMs > timeoutMs;
    if (existing !== token && expired) {
      // Steal: remove the expired foreign lock, then loop to re-create as ours.
      await fs.unlink(lockPath).catch(() => {});
      continue;
    }
    // It is ours (re-entrancy is not supported; treat as held) or not yet
    // expired — wait and retry until the acquisition budget is exhausted.
    if (Date.now() - start > acquireTimeoutMs) {
      throw new AttemptStoreError(`lock timeout for ${lockPath}`, "ERR_ATTEMPT_LOCK_TIMEOUT");
    }
    await sleep(pollMs);
  }

  try {
    return await fn();
  } finally {
    // Only unlink if WE still own the lock (no lock-stealing on release).
    const owner = await readLockOwner(lockPath);
    if (owner === token) {
      await fs.unlink(lockPath).catch(() => {});
    }
  }
}

async function readLockOwner(lockPath) {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed?.owner === "string" ? parsed.owner : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Idempotency payload equality (spec §assertSameCommandPayload; GPT#1) ───────
// Two commands are "the same" iff their type and fields match. The server `at`
// timestamp is EXCLUDED so a crash-retry that re-stamps `at` is still idempotent.
export function assertSameCommandPayload(prior, event) {
  const priorType = String(prior?.type || "");
  const eventType = String(event?.type || "");
  if (priorType !== eventType) {
    throw new AttemptStoreError(
      `event ${eventType || "(none)"} conflicts with prior ${priorType || "(none)"} for same eventId`,
      "ERR_EVENT_ID_CONFLICT",
    );
  }
  const priorFields = stableStringify(prior?.fields ?? {});
  const eventFields = stableStringify(event?.fields ?? {});
  if (priorFields !== eventFields) {
    throw new AttemptStoreError(
      `event ${eventType} payload differs from the prior command for the same eventId`,
      "ERR_EVENT_ID_CONFLICT",
    );
  }
}

// ── Projector (spec §projectAttemptFromEvents) ───────────────────────────────
// Replays raw events into a ValidationAttempt projection. Handles three event
// classes:
//   1. reducer transitions (define_activation, …) → reduceValidationAttempt.
//   2. legacy_imported (store control) → apply recoverable fields / hints /
//      disposition directly, WITHOUT passing to the reducer (avoids
//      ERR_UNKNOWN_TRANSITION).
//   3. answer_superseded (store control) → logical branch replacement: replay the
//      effective branch up to but EXCLUDING targetEventId, drop the superseded
//      downstream events from the effective set, then apply the replacement
//      reducer event. Raw events[] are preserved; only the projection changes.
const STORE_CONTROL_EVENT_TYPES = Object.freeze(new Set(["legacy_imported", "answer_superseded"]));

export function projectAttemptFromEvents(events = [], { id = "", goalLane = "get_users", createdAt = "" } = {}) {
  const raw = Array.isArray(events) ? events : [];

  // Resolve the EFFECTIVE event list by applying any answer_superseded directives
  // as logical branch replacements over the raw timeline. We never mutate `raw`.
  const effective = resolveEffectiveEvents(raw);

  let attempt = createValidationAttempt({ id, goalLane, createdAt });
  for (const event of effective) {
    attempt = applyProjectionEvent(attempt, event);
  }
  return attempt;
}

// Apply answer_superseded directives to produce the effective (replayable) event
// stream. Each answer_superseded names a targetEventId (the answer being
// replaced) and carries a `replacement` reducer event. Semantics:
//   - keep every effective event strictly BEFORE targetEventId,
//   - drop targetEventId and every later reducer-transition event (the superseded
//     downstream branch), keeping any control events,
//   - splice in the replacement reducer event at the target's position.
// Multiple supersede directives apply in timeline order, each over the prior
// effective stream.
function resolveEffectiveEvents(raw) {
  let effective = raw.filter((e) => e && e.type !== "answer_superseded");
  const directives = raw.filter((e) => e && e.type === "answer_superseded");

  for (const directive of directives) {
    const fields = directive.fields && typeof directive.fields === "object" ? directive.fields : {};
    const targetEventId = String(fields.targetEventId || "").trim();
    if (!targetEventId) {
      throw new AttemptStoreError(
        "answer_superseded requires fields.targetEventId",
        "ERR_SUPERSEDE_NO_TARGET",
      );
    }
    const replacement = fields.replacement;
    if (!replacement || typeof replacement !== "object" || !replacement.type) {
      throw new AttemptStoreError(
        "answer_superseded requires a fields.replacement reducer event",
        "ERR_SUPERSEDE_NO_REPLACEMENT",
      );
    }
    const targetIndex = effective.findIndex((e) => e && e.eventId === targetEventId);
    if (targetIndex < 0) {
      throw new AttemptStoreError(
        `answer_superseded targetEventId not found in effective branch: ${targetEventId}`,
        "ERR_SUPERSEDE_TARGET_MISSING",
      );
    }
    const before = effective.slice(0, targetIndex);
    // Downstream after the target: keep control events, drop superseded reducer
    // transitions (the branch being replaced).
    const after = effective
      .slice(targetIndex + 1)
      .filter((e) => e && STORE_CONTROL_EVENT_TYPES.has(e.type));
    // The replacement is itself a reducer event; give it a stable synthetic
    // eventId so the reducer's own idempotency bookkeeping stays consistent.
    const replacementEvent = {
      ...replacement,
      eventId: String(replacement.eventId || `superseded:${targetEventId}`),
    };
    effective = [...before, replacementEvent, ...after];
  }
  return effective;
}

function applyProjectionEvent(attempt, event) {
  const type = String(event?.type || "").trim();
  if (type === "legacy_imported") {
    return applyLegacyImported(attempt, event);
  }
  if (type === "answer_superseded") {
    // Already resolved away in resolveEffectiveEvents; should never reach here.
    throw new AttemptStoreError(
      "answer_superseded must be resolved before projection",
      "ERR_SUPERSEDE_UNRESOLVED",
    );
  }
  // Reducer transition event — fold through the pure contract reducer.
  return reduceValidationAttempt(attempt, {
    type,
    eventId: event.eventId,
    fields: event.fields,
    at: event.at,
  });
}

// legacy_imported: bring recoverable plan fields, migrationHints, and the
// migrationDisposition into the projection WITHOUT a reducer transition. The
// recoverable fields are applied as a plain patch; recoverableState (if present
// and legal) is honored so a migrated interview can resume at the right slot.
function applyLegacyImported(attempt, event) {
  const fields = event?.fields && typeof event.fields === "object" ? event.fields : {};
  const next = { ...attempt };

  const recoverable = fields.recoverableFields && typeof fields.recoverableFields === "object"
    ? fields.recoverableFields
    : {};
  for (const [key, value] of Object.entries(recoverable)) {
    next[key] = value;
  }
  if (fields.migrationHints !== undefined) {
    next.migrationHints = fields.migrationHints;
  }
  if (typeof fields.migrationDisposition === "string" && fields.migrationDisposition) {
    next.migrationDisposition = fields.migrationDisposition;
  }
  if (typeof fields.recoverableState === "string" && fields.recoverableState) {
    next.status = fields.recoverableState;
  }
  return next;
}

// ── projectAttempt (read + replay, NO in-process cache; GPT#10) ───────────────
export async function projectAttempt({ workspaceRoot, attemptId } = {}) {
  const log = await loadAttemptLog({ workspaceRoot });
  const record = log.attempts[attemptId];
  if (!record) return null;
  return projectAttemptFromEvents(record.events || [], {
    id: record.attemptId,
    goalLane: record.goalLane,
    createdAt: record.createdAt,
  });
}

// ── startAttempt (spec §startAttempt; GPT#9 check+create one operation) ────────
export async function startAttempt({
  workspaceRoot,
  goalLane = "get_users",
  day,
  source = "",
  sessionId = "",
  attemptId,
  now = new Date(),
} = {}) {
  if (!attemptId) {
    throw new AttemptStoreError("attemptId is required (caller-provided for determinism)", "ERR_NO_ATTEMPT_ID");
  }
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot });
  return withAttemptLeaseLock(filePath, async () => {
    const log = await loadAttemptLog({ workspaceRoot });

    if (log.attempts[attemptId]) {
      throw new AttemptStoreError(`attempt ${attemptId} already exists`, "ERR_ATTEMPT_ALREADY_EXISTS");
    }

    // GPT 6.8 / spec: check + create is ONE locked operation. A new attempt may
    // only start when every existing attempt is RESOLVED (terminal).
    const existingProjections = Object.values(log.attempts).map((rec) =>
      projectAttemptFromEvents(rec.events || [], {
        id: rec.attemptId,
        goalLane: rec.goalLane,
        createdAt: rec.createdAt,
      }),
    );
    if (!canStartNewAttempt(existingProjections)) {
      throw new AttemptStoreError(
        "cannot start a new attempt while another is open",
        "ERR_ATTEMPT_ALREADY_OPEN",
      );
    }

    const createdAt = toIso(now);
    const record = {
      attemptId,
      goalLane,
      day: day ?? null,
      source: String(source || ""),
      createdSessionId: String(sessionId || ""),
      revision: 0,
      createdAt,
      updatedAt: createdAt,
      events: [],
      deliveries: {},
    };
    const nextLog = {
      ...log,
      updatedAt: createdAt,
      attempts: { ...log.attempts, [attemptId]: record },
    };
    await durableWriteJson(filePath, nextLog);
    return record;
  });
}

// ── commitAttemptEvent (spec §commitAttemptEvent — THE single writer) ─────────
// Order is load-bearing (these are the GPT R1 release blockers):
//   1. strict load; record must exist.
//   2. eventId = event.requestId (required).
//   3. IDEMPOTENCY BEFORE CAS: if eventId already present, compare payload
//      (type+fields only, excluding `at`) → return {applied:false} regardless of
//      a stale expectedRevision. Re-queue a missing pending delivery.
//   4. CAS: only for a FIRST-SEEN event — record.revision !== expectedRevision
//      throws ERR_ATTEMPT_REVISION_CONFLICT.
//   5. project + reduce (illegal transition throws — fail-closed).
//   6. append raw event (audit included), revision++, record pending delivery.
//   7. durable atomic write.
export async function commitAttemptEvent({
  workspaceRoot,
  attemptId,
  expectedRevision,
  event,
  responsePayload,
  now = new Date(),
} = {}) {
  if (!attemptId) {
    throw new AttemptStoreError("attemptId is required", "ERR_NO_ATTEMPT_ID");
  }
  if (!event || typeof event !== "object") {
    throw new AttemptStoreError("event is required", "ERR_NO_EVENT");
  }
  const requestId = typeof event.requestId === "string" ? event.requestId.trim() : "";
  if (!requestId) {
    throw new AttemptStoreError("event.requestId is required (== eventId)", "ERR_NO_REQUEST_ID");
  }
  const eventId = requestId; // requestId IS the eventId

  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot });
  return withAttemptLeaseLock(filePath, async () => {
    const log = await loadAttemptLog({ workspaceRoot });
    const record = log.attempts[attemptId];
    if (!record) {
      throw new AttemptStoreError(`attempt ${attemptId} not found`, "ERR_ATTEMPT_NOT_FOUND");
    }
    const events = Array.isArray(record.events) ? record.events : [];

    // 3. IDEMPOTENCY BEFORE CAS (GPT#1).
    const prior = events.find((e) => e && e.eventId === eventId);
    if (prior) {
      assertSameCommandPayload(prior, event); // throws ERR_EVENT_ID_CONFLICT on real divergence
      const projection = projectAttemptFromEvents(events, {
        id: record.attemptId,
        goalLane: record.goalLane,
        createdAt: record.createdAt,
      });
      // Re-queue a delivery that was requested but never recorded (CP2 / crash
      // between event-append and delivery write). Never overwrite a delivered one.
      if (responsePayload !== undefined && !record.deliveries?.[eventId]) {
        const updatedAt = toIso(now);
        const nextRecord = {
          ...record,
          updatedAt,
          deliveries: {
            ...(record.deliveries || {}),
            [eventId]: {
              sessionId: event.sessionId || record.createdSessionId || "",
              requestId,
              responsePayload,
              status: "pending",
            },
          },
        };
        const nextLog = {
          ...log,
          updatedAt,
          attempts: { ...log.attempts, [attemptId]: nextRecord },
        };
        await durableWriteJson(filePath, nextLog);
      }
      return { projection, revision: record.revision, eventId, applied: false };
    }

    // 4. CAS (only for first-seen events).
    if (record.revision !== expectedRevision) {
      throw new AttemptStoreError(
        `revision conflict: expected ${String(expectedRevision)} but store is at ${record.revision}`,
        "ERR_ATTEMPT_REVISION_CONFLICT",
      );
    }

    // 5. project + reduce (illegal transition → reducer throws = fail-closed).
    const projection = projectAttemptFromEvents(events, {
      id: record.attemptId,
      goalLane: record.goalLane,
      createdAt: record.createdAt,
    });
    const next = reduceValidationAttempt(projection, {
      type: event.type,
      eventId,
      fields: event.fields,
      at: event.at,
    });

    // 6. append raw event (with immutable audit), bump revision, queue delivery.
    const rawEvent = {
      eventId,
      type: String(event.type || ""),
      fields: event.fields && typeof event.fields === "object" ? event.fields : {},
      at: event.at != null ? String(event.at) : toIso(now),
      requestId,
      sessionId: event.sessionId || record.createdSessionId || "",
      audit: normalizeAudit(event.audit),
    };
    const nextEvents = [...events, rawEvent];
    const nextRevision = record.revision + 1;
    const updatedAt = toIso(now);

    const nextDeliveries = { ...(record.deliveries || {}) };
    if (responsePayload !== undefined) {
      nextDeliveries[eventId] = {
        sessionId: rawEvent.sessionId,
        requestId,
        responsePayload,
        status: "pending",
      };
    }

    const nextRecord = {
      ...record,
      revision: nextRevision,
      updatedAt,
      events: nextEvents,
      deliveries: nextDeliveries,
    };
    const nextLog = {
      ...log,
      updatedAt,
      attempts: { ...log.attempts, [attemptId]: nextRecord },
    };

    // 7. durable atomic write.
    await durableWriteJson(filePath, nextLog);

    return { projection: next, revision: nextRevision, eventId, applied: true };
  });
}

function normalizeAudit(audit) {
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) {
    return { questionText: "", responseText: "", promptSnapshot: null, submissions: [] };
  }
  return {
    questionText: typeof audit.questionText === "string" ? audit.questionText : "",
    responseText: typeof audit.responseText === "string" ? audit.responseText : "",
    promptSnapshot: audit.promptSnapshot ?? null,
    submissions: Array.isArray(audit.submissions) ? audit.submissions : [],
  };
}

// ── Durable outbox (spec §deliveries; GPT#2) ──────────────────────────────────
export async function markDelivered({ workspaceRoot, attemptId, eventId } = {}) {
  if (!attemptId) throw new AttemptStoreError("attemptId is required", "ERR_NO_ATTEMPT_ID");
  if (!eventId) throw new AttemptStoreError("eventId is required", "ERR_NO_EVENT_ID");
  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot });
  return withAttemptLeaseLock(filePath, async () => {
    const log = await loadAttemptLog({ workspaceRoot });
    const record = log.attempts[attemptId];
    if (!record) {
      throw new AttemptStoreError(`attempt ${attemptId} not found`, "ERR_ATTEMPT_NOT_FOUND");
    }
    const delivery = record.deliveries?.[eventId];
    if (!delivery) {
      throw new AttemptStoreError(`no delivery for event ${eventId}`, "ERR_NO_DELIVERY");
    }
    if (delivery.status === "delivered") {
      return { applied: false, status: "delivered" }; // idempotent
    }
    const updatedAt = new Date().toISOString();
    const nextRecord = {
      ...record,
      updatedAt,
      deliveries: {
        ...record.deliveries,
        [eventId]: { ...delivery, status: "delivered" },
      },
    };
    const nextLog = {
      ...log,
      updatedAt,
      attempts: { ...log.attempts, [attemptId]: nextRecord },
    };
    await durableWriteJson(filePath, nextLog);
    return { applied: true, status: "delivered" };
  });
}

// List every pending delivery across all attempts (restart re-post; GPT#2).
export async function pendingDeliveries({ workspaceRoot } = {}) {
  const log = await loadAttemptLog({ workspaceRoot });
  const out = [];
  for (const record of Object.values(log.attempts)) {
    const deliveries = record.deliveries || {};
    for (const [eventId, delivery] of Object.entries(deliveries)) {
      if (delivery && delivery.status === "pending") {
        out.push({
          attemptId: record.attemptId,
          eventId,
          sessionId: delivery.sessionId || "",
          requestId: delivery.requestId || "",
          responsePayload: delivery.responsePayload,
        });
      }
    }
  }
  return out;
}

// ── small helpers ─────────────────────────────────────────────────────────────
function toIso(now) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === "string" && now) return now;
  return new Date().toISOString();
}

// office-hours-attempt-store.mjs — durable, crash-safe event store for the
// Office Hours ValidationAttempt lifecycle (R1.a, infra-only — NOT wired into
// index.mjs; blast-radius-0 per the GPT-5.5 Pro R1 review).
//
// What this module is: the single writer + reader for the per-workspace
// office-hours-attempts.json event log. It owns durability (fsync + dir-sync),
// concurrency (owner-token lease lock), idempotency (eventId == requestId,
// checked BEFORE the CAS revision check), a durable 3-state outbox (deliveries[]:
// pending → posted → consumed, plus canceled, for restart re-post), and a
// projector that replays raw events through the pure contract reducer
// (reduceValidationAttempt) plus one store-level control event the reducer does
// not know about (answer_superseded — a logical revision of an earlier answer).
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
//   - There is NO legacy turn-log migration path here: callers always seed a fresh
//     attempt via startAttempt. The store fabricates nothing.

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
  payloadHashOf,
  cardDefinition,
  VALIDATION_ATTEMPT_ACTIVE_STATES,
  VALIDATION_ATTEMPT_WAIT_STATES,
} from "./office-hours-contract.mjs";

const ACTIVE_GATHER_STATES = new Set(VALIDATION_ATTEMPT_ACTIVE_STATES);

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
  // Per-record strict validation (fail-closed; owner directive: no fail-open). A
  // structurally-valid root with a corrupt record (events non-array, deliveries
  // non-object, bad revision) must THROW — never be silently coerced to empty by a
  // downstream `Array.isArray(...)?:[]` / `||{}`, which would fabricate authority and
  // let a commit overwrite/destroy the corrupt-but-present prior data.
  for (const [key, record] of Object.entries(parsed.attempts)) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new AttemptStoreError(`attempt record ${key} must be an object at ${filePath}`, "ERR_ATTEMPT_LOG_SCHEMA");
    }
    if (typeof record.attemptId !== "string" || !record.attemptId.trim()) {
      throw new AttemptStoreError(`attempt record ${key} has invalid attemptId at ${filePath}`, "ERR_ATTEMPT_LOG_SCHEMA");
    }
    if (typeof record.revision !== "number" || !Number.isFinite(record.revision) || record.revision < 0) {
      throw new AttemptStoreError(`attempt record ${key} has invalid revision at ${filePath}`, "ERR_ATTEMPT_LOG_SCHEMA");
    }
    if (!Array.isArray(record.events)) {
      throw new AttemptStoreError(`attempt record ${key} events must be an array at ${filePath}`, "ERR_ATTEMPT_LOG_SCHEMA");
    }
    if (!record.deliveries || typeof record.deliveries !== "object" || Array.isArray(record.deliveries)) {
      throw new AttemptStoreError(`attempt record ${key} deliveries must be an object at ${filePath}`, "ERR_ATTEMPT_LOG_SCHEMA");
    }
    // Each delivery must carry a CANONICAL status. A non-canonical value (a legacy
    // "delivered", or a partial/foreign write) would be silently excluded from the
    // re-post set and rejected by every delivery transition — an un-consumed response
    // lost with no recovery path. Fail closed instead of fail-open.
    for (const [evId, delivery] of Object.entries(record.deliveries)) {
      if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) {
        throw new AttemptStoreError(`attempt record ${key} delivery ${evId} must be an object at ${filePath}`, "ERR_ATTEMPT_LOG_SCHEMA");
      }
      if (!["pending", "posted", "consumed", "canceled"].includes(delivery.status)) {
        throw new AttemptStoreError(`attempt record ${key} delivery ${evId} has invalid status "${String(delivery.status)}" at ${filePath}`, "ERR_ATTEMPT_LOG_SCHEMA");
      }
    }
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

// ── Idempotency payload equality (spec §assertSameCommandPayload; GPT R1.b E) ──
// Two commands are "the same" iff their type, fields AND audit region all match.
// The server `at` timestamp is EXCLUDED (a crash-retry re-stamps `at`, which must
// still be idempotent) but the audit (questionText / responseText /
// responseDescription / promptSnapshot / submissions) IS part of the identity:
// a retry that reuses the same requestId but carries a different captured answer
// or prompt is a genuine CONFLICT, not a false dedupe. The hash is canonical
// (stable key order) so field/audit key ordering never matters.
function commandIdentityHash(command) {
  return payloadHashOf({
    type: String(command?.type || ""),
    fields: command?.fields && typeof command.fields === "object" && !Array.isArray(command.fields)
      ? command.fields
      : {},
    audit: auditIdentity(command?.audit),
  });
}

// The audit subset that participates in command identity. normalizeAudit shapes
// stored events identically, so a stored prior and an incoming command hash equal.
function auditIdentity(audit) {
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) {
    return { questionText: "", responseText: "", responseDescription: "", promptSnapshot: null, submissions: [] };
  }
  return {
    questionText: typeof audit.questionText === "string" ? audit.questionText : "",
    responseText: typeof audit.responseText === "string" ? audit.responseText : "",
    responseDescription: typeof audit.responseDescription === "string" ? audit.responseDescription : "",
    promptSnapshot: audit.promptSnapshot ?? null,
    submissions: Array.isArray(audit.submissions) ? audit.submissions : [],
  };
}

export function assertSameCommandPayload(prior, event) {
  const priorType = String(prior?.type || "");
  const eventType = String(event?.type || "");
  if (priorType !== eventType) {
    throw new AttemptStoreError(
      `event ${eventType || "(none)"} conflicts with prior ${priorType || "(none)"} for same eventId`,
      "ERR_EVENT_ID_CONFLICT",
    );
  }
  if (commandIdentityHash(prior) !== commandIdentityHash(event)) {
    throw new AttemptStoreError(
      `event ${eventType} payload (fields/audit) differs from the prior command for the same eventId`,
      "ERR_EVENT_ID_CONFLICT",
    );
  }
}

// ── Projector (spec §projectAttemptFromEvents) ───────────────────────────────
// Replays raw events into a ValidationAttempt projection. Two event classes:
//   1. reducer transitions (define_activation, …) → reduceValidationAttempt.
//   2. answer_superseded (the ONLY store-control event) → logical revision of an
//      earlier answer: at the supersede's position in the timeline, the effective
//      branch is truncated back to BEFORE targetEventId and the replacement reducer
//      event is spliced in. Crucially, this is processed SEQUENTIALLY over the raw
//      timeline (GPT R1.b C) so any events appended AFTER the supersede are
//      preserved: A → B → S(A→A′) → C projects to [A′, C], NOT [A′]. Repeated
//      revisions are supported — a later supersede targets whatever is in the
//      effective branch at its own position. Raw events[] are never mutated.
// answer_superseded is the ONLY store-level control event; everything else is a
// reducer transition. Classification is a direct string compare at the two sites
// that need it (resolveEffectiveEvents, applyProjectionEvent).

export function projectAttemptFromEvents(events = [], { id = "", goalLane = "get_users", createdAt = "" } = {}) {
  const effective = resolveEffectiveEvents(events);
  let attempt = createValidationAttempt({ id, goalLane, createdAt });
  for (const event of effective) {
    attempt = applyProjectionEvent(attempt, event);
  }
  return attempt;
}

// Resolve the EFFECTIVE (replayable) event list by walking the raw timeline ONCE,
// in order. A non-supersede event is appended to the current effective branch. An
// answer_superseded is applied AT ITS POSITION: it truncates the effective branch
// back to just before its targetEventId and splices in the replacement reducer
// event. Events that come after the supersede in the raw timeline are then appended
// onto the revised branch, so they survive the revision. We never mutate `events`.
function resolveEffectiveEvents(events) {
  const raw = Array.isArray(events) ? events : [];
  const effective = [];
  for (const ev of raw) {
    if (!ev) continue;
    if (ev.type !== "answer_superseded") {
      effective.push(ev);
      continue;
    }
    applySupersedeToBranch(effective, ev);
  }
  return effective;
}

// Mutate `effective` (the in-progress branch) per a single answer_superseded
// directive: find targetEventId in the CURRENT branch, drop it and everything that
// followed it in the branch (the superseded downstream), then push the replacement.
function applySupersedeToBranch(effective, directive) {
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
  // Truncate to just before the target (drop target + its downstream within the
  // current branch), then splice in the replacement reducer event.
  effective.length = targetIndex;
  effective.push({
    ...replacement,
    // Stable synthetic eventId keyed by the supersede directive so the reducer's
    // idempotency bookkeeping stays consistent and repeated revisions don't collide.
    eventId: String(replacement.eventId || `superseded:${directive.eventId || targetEventId}`),
  });
}

function applyProjectionEvent(attempt, event) {
  const type = String(event?.type || "").trim();
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

// ── Outbox ↔ effective-branch reconciliation (one rule for all delivery validity) ─
// A delivery keyed K is a valid re-post target IFF its EFFECT is in the current
// effective branch. A normal event's effect is the event itself (id K). A supersede's
// effect is the replacement it splices in, whose synthetic id is `superseded:K`. This
// single predicate replaces the per-call ad-hoc cancellation logic, so a supersede
// that drops a branch — or a re-commit of an already-reverted event — can never leave
// a stale pending/posted delivery that re-posts a now-invalid response after a crash.
function effectiveEventIdSet(events) {
  return new Set(resolveEffectiveEvents(events).map((e) => e && e.eventId).filter(Boolean));
}
function deliveryEffectInBranch(deliveryKey, effectiveIds) {
  return effectiveIds.has(deliveryKey) || effectiveIds.has(`superseded:${deliveryKey}`);
}
// Cancel every pending/posted delivery whose effect is no longer in the branch.
function reconcileDeliveriesToBranch(deliveries, effectiveIds) {
  const next = { ...(deliveries || {}) };
  for (const [k, d] of Object.entries(next)) {
    if (d && (d.status === "pending" || d.status === "posted") && !deliveryEffectInBranch(k, effectiveIds)) {
      next[k] = { ...d, status: "canceled" };
    }
  }
  return next;
}

// ── projectAttempt (read + replay, NO in-process cache; GPT#10) ───────────────
// Returns ONE read snapshot: { projection, revision, record, effectiveEvents }
// (GPT R1.b F). `revision` is required for the supersede/commit CAS token plumbing;
// `effectiveEvents` is the post-supersede branch the projection was built from.
// Returns null for an unknown attemptId.
export async function projectAttempt({ workspaceRoot, attemptId } = {}) {
  const log = await loadAttemptLog({ workspaceRoot });
  const record = log.attempts[attemptId];
  if (!record) return null;
  const events = Array.isArray(record.events) ? record.events : [];
  const meta = { id: record.attemptId, goalLane: record.goalLane, createdAt: record.createdAt };
  const effectiveEvents = resolveEffectiveEvents(events);
  const projection = projectAttemptFromEvents(events, meta);
  return { projection, revision: record.revision, record, effectiveEvents };
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
//      (type + fields + audit, excluding `at`) → return {applied:false} regardless
//      of a stale expectedRevision. Re-queue a missing pending delivery.
//   4. CAS: only for a FIRST-SEEN event — record.revision !== expectedRevision
//      throws ERR_ATTEMPT_REVISION_CONFLICT.
//   5. build the raw candidate event, then VALIDATE THE WHOLE CANDIDATE LOG through
//      the projector (GPT R1.b B): projectAttemptFromEvents([...events, rawEvent]).
//      The projector understands control events (answer_superseded) the single-event
//      reducer does not, so this is what lets answer_superseded ever commit. Any
//      illegal transition / supersede violation throws here = fail-closed.
//   6. durable-write the candidate log ONLY on success, revision++, queue delivery.
//   7. durable atomic write.
//
// `preAppend` (A′ receipt cutover) — optional async hook run INSIDE the lock, AFTER the
// idempotency + CAS checks and BEFORE the event is built, with the CURRENT
// `{ events, record, meta, projection }`. It returns the event `fields` to append (or
// throws to abort, writing nothing). This closes the TOCTOU the receipt rail would
// otherwise have: a caller that verifies a receipt + consumes a single-use artifact must
// do so against the EXACT attempt state the commit appends against, so a concurrent
// same-attempt event cannot land between verification and append (which would burn a
// valid receipt or let a stale receipt advance a superseded contract). When preAppend is
// present the idempotent-retry branch skips the payload-equality check (the host-derived
// fields are not known without re-running preAppend, which a retry must NOT do — the
// single-use artifact was already consumed on the first landing). A reused eventId with a
// DIFFERENT transition type is still rejected (type check above the skip).
//
// KNOWN LIMITATIONS (GPT-5.5 Pro fix re-review; deferred to the full reservation machine,
// acceptable at N=0 single-user where there is no contention):
//   - Crash-consistency: if the durable attempt-log write throws AFTER preAppend's consume
//     durably landed, an exact retry converges only while the receipt (1h TTL), blob,
//     registration availability, and projection are unchanged; a >1h-delayed retry could
//     orphan the consumed artifact. The window is a microsecond crash between two same-lock
//     writes — negligible at N=0. A durable reservation (persist prepared evidence with the
//     consumption for replay) is the proper fix.
//   - Lease steal: the attempt lease (30s) is not renewed while preAppend performs nested
//     registry/blob/key I/O; under pathological contention (another writer holding the
//     registry lease ~30s) the attempt lock could be stolen mid-critical-section. At N=0
//     single-user there is no contention; a heartbeat/renew is the proper fix.
export async function commitAttemptEvent({
  workspaceRoot,
  attemptId,
  expectedRevision,
  event,
  responsePayload,
  now = new Date(),
  preAppend,
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
  // Two RESERVED internal eventId namespaces the store mints itself; a caller
  // requestId in either would collide and corrupt the supersede machinery
  // (fail-closed — reject):
  //   "superseded:" — projector synthetic replacement ids (`superseded:<directiveId>`);
  //                   a collision would let a supersede over-cancel a surviving delivery.
  //   "revise:"     — deterministic supersede command ids (supersedeCommandId); a
  //                   collision would make a later legitimate supersede falsely dedupe
  //                   (idempotency match) and silently skip all its guards.
  if (requestId.startsWith("superseded:") || requestId.startsWith("revise:")) {
    throw new AttemptStoreError(
      'event.requestId may not use a reserved namespace ("superseded:" / "revise:")',
      "ERR_RESERVED_EVENT_ID",
    );
  }
  // Store-level control events (answer_superseded) are produced ONLY by
  // supersedeAnswer, which runs all the revision guards. Committing one out-of-band
  // here would be persisted by the projector with ZERO guards (CAS/status/target/
  // hash/delivery-cancel all skipped), corrupting the effective branch. Reject it.
  if (String(event.type || "") === "answer_superseded") {
    throw new AttemptStoreError(
      "answer_superseded is a control event; use supersedeAnswer, not commitAttemptEvent",
      "ERR_CONTROL_EVENT_VIA_COMMIT",
    );
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
      // A reused eventId with a DIFFERENT transition type is ALWAYS a conflict — including
      // on the preAppend path, where the host-derived fields are not comparable on a retry.
      // Without this, a different graded transition under the same requestId would silently
      // dedupe into a false no-op success (GPT-5.5 Pro fix re-review #1).
      if (String(prior.type || "") !== String(event.type || "")) {
        throw new AttemptStoreError(
          `event ${String(event.type || "") || "(none)"} conflicts with prior ${String(prior.type || "") || "(none)"} for the same eventId`,
          "ERR_EVENT_ID_CONFLICT",
        );
      }
      // preAppend path: the fields are host-derived from a single-use receipt and are not
      // known on a retry (preAppend must NOT re-run — the artifact was already consumed).
      // The (eventId, type) identity above is sufficient; skip only the full fields check.
      if (typeof preAppend !== "function") {
        assertSameCommandPayload(prior, event); // throws ERR_EVENT_ID_CONFLICT on real divergence
      }
      const projection = projectAttemptFromEvents(events, {
        id: record.attemptId,
        goalLane: record.goalLane,
        createdAt: record.createdAt,
      });
      // Re-queue a delivery that was requested but never recorded (CP2 / crash
      // between event-append and delivery write). Never overwrite an existing one, and
      // NEVER re-queue for an event a later supersede has dropped from the effective
      // branch (else the re-post set gains a stale, already-reverted confirmation).
      const reQueueInBranch = deliveryEffectInBranch(eventId, effectiveEventIdSet(events));
      if (responsePayload !== undefined && !record.deliveries?.[eventId] && reQueueInBranch) {
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

    // 5. Build the raw candidate event, then validate the WHOLE candidate log via
    // the projector (GPT R1.b B). The projector folds reducer transitions AND
    // resolves control events (answer_superseded); an illegal transition or an
    // invalid supersede throws here, so nothing is written = fail-closed.
    const meta = { id: record.attemptId, goalLane: record.goalLane, createdAt: record.createdAt };
    // preAppend runs HERE — inside the lock, after CAS, against the current projection —
    // so the receipt verification + single-use consume it performs are bound to the exact
    // state this commit appends against (closes the dry-run↔commit TOCTOU).
    let resolvedFields = event.fields && typeof event.fields === "object" ? event.fields : {};
    if (typeof preAppend === "function") {
      const currentProjection = projectAttemptFromEvents(events, meta);
      resolvedFields = await preAppend({ events, record, meta, projection: currentProjection });
      if (!resolvedFields || typeof resolvedFields !== "object" || Array.isArray(resolvedFields)) {
        throw new AttemptStoreError("preAppend must return an event fields object", "ERR_PREAPPEND_FIELDS");
      }
    }
    const rawEvent = {
      eventId,
      type: String(event.type || ""),
      fields: resolvedFields,
      at: event.at != null ? String(event.at) : toIso(now),
      requestId,
      sessionId: event.sessionId || record.createdSessionId || "",
      audit: normalizeAudit(event.audit),
    };
    const nextEvents = [...events, rawEvent];
    const next = projectAttemptFromEvents(nextEvents, meta);

    // 6. append raw event (with immutable audit), bump revision, queue delivery.
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

// ── supersedeAnswer (spec §G — revise an earlier gather answer) ───────────────
// The six gather transitions are the "plan". Before any irreversible action proof
// is recorded the founder may revise an earlier answer (e.g. picked the wrong
// candidate). This is the ONLY producer of answer_superseded events; it runs ALL
// the guards inside the lock, BEFORE the durable write, then cancels any downstream
// deliveries the revision drops.
//

// The deterministic supersede command id (retry-safe): re-sending the SAME revision
// yields the SAME eventId, so the idempotency gate dedupes it (no double-append).
export function supersedeCommandId(attemptId, targetEventId, replacement) {
  const replacementHash = payloadHashOf({
    type: String(replacement?.type || ""),
    fields: replacement?.fields && typeof replacement.fields === "object" ? replacement.fields : {},
  });
  return `revise:${attemptId}:${targetEventId}:${replacementHash}`;
}

// Canonical hash of a stored target event EXCLUDING the server `at` (matches the
// command-identity convention): targetEventId + type + fields + audit.
function targetPayloadHash(targetEvent) {
  return payloadHashOf({
    eventId: String(targetEvent?.eventId || ""),
    type: String(targetEvent?.type || ""),
    fields: targetEvent?.fields && typeof targetEvent.fields === "object" ? targetEvent.fields : {},
    audit: auditIdentity(targetEvent?.audit),
  });
}

export async function supersedeAnswer({
  workspaceRoot,
  attemptId,
  expectedRevision,
  targetEventId,
  cardType,
  transition,
  expectedTargetPayloadHash,
  replacement,
  responsePayload,
  now = new Date(),
} = {}) {
  if (!attemptId) throw new AttemptStoreError("attemptId is required", "ERR_NO_ATTEMPT_ID");
  const tgt = String(targetEventId || "").trim();
  if (!tgt) throw new AttemptStoreError("targetEventId is required", "ERR_SUPERSEDE_NO_TARGET");
  if (!replacement || typeof replacement !== "object" || !replacement.type) {
    throw new AttemptStoreError("replacement reducer event is required", "ERR_SUPERSEDE_NO_REPLACEMENT");
  }

  const filePath = resolveOfficeHoursAttemptLogPath({ workspaceRoot });
  return withAttemptLeaseLock(filePath, async () => {
    const log = await loadAttemptLog({ workspaceRoot });
    const record = log.attempts[attemptId];
    if (!record) {
      throw new AttemptStoreError(`attempt ${attemptId} not found`, "ERR_ATTEMPT_NOT_FOUND");
    }
    const events = Array.isArray(record.events) ? record.events : [];
    const meta = { id: record.attemptId, goalLane: record.goalLane, createdAt: record.createdAt };

    // The deterministic command id (== eventId == requestId) makes a retry idempotent.
    const eventId = supersedeCommandId(attemptId, tgt, replacement);

    // IDEMPOTENCY BEFORE CAS: the identical revision was already committed → no-op.
    const priorSupersede = events.find((e) => e && e.eventId === eventId);
    if (priorSupersede) {
      const projection = projectAttemptFromEvents(events, meta);
      // CP2 (mirror commitAttemptEvent's re-queue): if the supersede was durably
      // appended but its delivery write was lost — or the first call carried no
      // responsePayload and a retry carries one — re-queue the supersede's own pending
      // delivery, but ONLY while the supersede is still in effect (its replacement
      // `superseded:<eventId>` is in the branch; a later supersede may have dropped it).
      const stillInBranch = deliveryEffectInBranch(eventId, effectiveEventIdSet(events));
      if (responsePayload !== undefined && !record.deliveries?.[eventId] && stillInBranch) {
        const updatedAt = toIso(now);
        const nextRecord = {
          ...record,
          updatedAt,
          deliveries: {
            ...(record.deliveries || {}),
            [eventId]: {
              sessionId: record.createdSessionId || "",
              requestId: eventId,
              responsePayload,
              status: "pending",
            },
          },
        };
        const nextLog = { ...log, updatedAt, attempts: { ...log.attempts, [attemptId]: nextRecord } };
        await durableWriteJson(filePath, nextLog);
      }
      return { projection, revision: record.revision, eventId, applied: false };
    }

    // GUARD 1 — expectedRevision CAS (only for a first-seen supersede).
    if (record.revision !== expectedRevision) {
      throw new AttemptStoreError(
        `revision conflict: expected ${String(expectedRevision)} but store is at ${record.revision}`,
        "ERR_ATTEMPT_REVISION_CONFLICT",
      );
    }

    // The current EFFECTIVE branch is what we revise against (post any prior supersede).
    const effective = resolveEffectiveEvents(events);

    // GUARD 5 — supersede is allowed ONLY while the attempt is still in an ACTIVE
    // gather state (pre-action). Gate on the PROJECTED STATUS, not a hardcoded set of
    // transition names: a terminal close via abandon_attempt carries none of the
    // "irreversible" action transitions yet must still block revision (otherwise a
    // failed/abandoned attempt could be silently resurrected to an active state).
    // WAIT states (plan committed to execution) keep the ERR_SUPERSEDE_AFTER_IRREVERSIBLE
    // code; terminal/suspended report ERR_SUPERSEDE_NOT_ACTIVE. Intentionally stricter
    // than "allow if a suspended attempt's resumeState is gather": a blocked/carried
    // attempt must be unblocked/resumed first, then revised — revising a suspended
    // attempt in place is disallowed (fail-closed, simpler, no in-place edit of a
    // suspended record).
    const currentStatus = projectAttemptFromEvents(events, meta).status;
    if (!ACTIVE_GATHER_STATES.has(currentStatus)) {
      throw new AttemptStoreError(
        `cannot supersede: attempt status is ${currentStatus}, not an active gather state`,
        VALIDATION_ATTEMPT_WAIT_STATES.has(currentStatus)
          ? "ERR_SUPERSEDE_AFTER_IRREVERSIBLE"
          : "ERR_SUPERSEDE_NOT_ACTIVE",
      );
    }

    // GUARD 2 — targetEventId must exist in the current effective branch.
    const targetEvent = effective.find((e) => e && e.eventId === tgt);
    if (!targetEvent) {
      throw new AttemptStoreError(
        `supersede target not found in effective branch: ${tgt}`,
        "ERR_SUPERSEDE_TARGET_MISSING",
      );
    }

    // GUARD 3 — the target is a gather transition matching the requested
    // cardType/transition, and the replacement targets the SAME slot.
    const card = cardDefinition(cardType);
    if (!card) {
      throw new AttemptStoreError(`unknown cardType: ${String(cardType)}`, "ERR_SUPERSEDE_BAD_CARD");
    }
    const wantTransition = String(transition || card.transition);
    if (card.transition !== wantTransition) {
      throw new AttemptStoreError(
        `transition ${wantTransition} does not match card ${cardType} (${card.transition})`,
        "ERR_SUPERSEDE_BAD_TRANSITION",
      );
    }
    if (String(targetEvent.type) !== card.transition) {
      throw new AttemptStoreError(
        `target ${tgt} is a ${targetEvent.type}, not the ${card.transition} of card ${cardType}`,
        "ERR_SUPERSEDE_BAD_TARGET",
      );
    }
    if (String(replacement.type) !== card.transition) {
      throw new AttemptStoreError(
        `replacement must be a ${card.transition} (got ${replacement.type})`,
        "ERR_SUPERSEDE_BAD_REPLACEMENT",
      );
    }

    // GUARD 4 — expectedTargetPayloadHash must match the stored target (excl. server at).
    if (expectedTargetPayloadHash !== undefined) {
      const actual = targetPayloadHash(targetEvent);
      if (String(expectedTargetPayloadHash) !== actual) {
        throw new AttemptStoreError(
          `supersede target payload hash mismatch for ${tgt}`,
          "ERR_SUPERSEDE_TARGET_CHANGED",
        );
      }
    }

    // Build the answer_superseded raw event. The replacement carries its own `at`
    // (defaults to the supersede's `at`) so transition-level time checks still apply.
    const at = now != null ? toIso(now) : new Date().toISOString();
    const replacementEvent = {
      type: String(replacement.type),
      fields: replacement.fields && typeof replacement.fields === "object" ? replacement.fields : {},
      at: replacement.at != null ? String(replacement.at) : at,
    };
    const rawEvent = {
      eventId,
      type: "answer_superseded",
      fields: { targetEventId: tgt, replacement: replacementEvent },
      at,
      requestId: eventId,
      sessionId: record.createdSessionId || "",
      audit: normalizeAudit(undefined),
    };
    const nextEvents = [...events, rawEvent];

    // GUARD 6 — the whole candidate branch must replay cleanly through the projector
    // (the projector resolves the supersede and folds the replacement; an illegal
    // replacement throws here = fail-closed, nothing written).
    const next = projectAttemptFromEvents(nextEvents, meta);

    // GUARD 7 — reconcile the outbox against the NEW effective branch. Any pending/
    // posted delivery whose effect this revision dropped is canceled. This single
    // sweep subsumes the per-event downstream cancellation AND a prior supersede's own
    // delivery (keyed `revise:...`, whose effect `superseded:revise:...` is no longer
    // in the branch) — so no reverted confirmation lingers in the re-post set.
    const newEffectiveIds = effectiveEventIdSet(nextEvents);
    const nextDeliveries = reconcileDeliveriesToBranch(record.deliveries, newEffectiveIds);
    // Queue the supersede's own delivery if requested (its effect — the replacement
    // `superseded:<eventId>` — IS in the new branch, so it is a valid re-post target).
    if (responsePayload !== undefined) {
      nextDeliveries[eventId] = {
        sessionId: rawEvent.sessionId,
        requestId: eventId,
        responsePayload,
        status: "pending",
      };
    }

    const nextRevision = record.revision + 1;
    const updatedAt = toIso(now);
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
    await durableWriteJson(filePath, nextLog);
    return { projection: next, revision: nextRevision, eventId, applied: true };
  });
}

// The persisted audit shape. Mirrors auditIdentity() so a stored prior event and
// an incoming retry command hash identically in assertSameCommandPayload (GPT R1.b
// E): the audit is part of command identity, never silently dropped.
function normalizeAudit(audit) {
  return auditIdentity(audit);
}

// ── Durable outbox — 3-state lifecycle (GPT R1.b D) ───────────────────────────
// A delivery moves pending → posted → consumed, with canceled as a terminal escape
// when a supersede drops the downstream event the delivery belonged to. The states:
//   pending   — committed, response written to the record, not yet posted to a client
//   posted    — written to the live transport / response file (may be lost on crash)
//   consumed  — a provider/waitForUserInputResponse confirmed it actually read it
//   canceled  — superseded downstream; must NOT be re-posted
// pendingDeliveries() returns BOTH pending AND posted: a posted-but-not-consumed
// delivery is a legitimate re-post target after a crash (the old "delivered = done"
// model lost exactly these). consumed + canceled are excluded.
export const DELIVERY_STATES = Object.freeze(["pending", "posted", "consumed", "canceled"]);

// Legal forward transitions. Same-state re-marks are idempotent (applied:false);
// any other move throws ERR_DELIVERY_TRANSITION (fail-closed, never fail-open).
const DELIVERY_TRANSITIONS = Object.freeze({
  pending: new Set(["posted", "consumed", "canceled"]),
  posted: new Set(["consumed", "canceled"]),
  consumed: new Set([]),
  canceled: new Set([]),
});

async function transitionDelivery({ workspaceRoot, attemptId, eventId }, toStatus) {
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
    const from = String(delivery.status || "pending");
    if (from === toStatus) {
      return { applied: false, status: toStatus }; // idempotent re-mark
    }
    const allowed = DELIVERY_TRANSITIONS[from];
    if (!allowed || !allowed.has(toStatus)) {
      throw new AttemptStoreError(
        `illegal delivery transition ${from} → ${toStatus} for event ${eventId}`,
        "ERR_DELIVERY_TRANSITION",
      );
    }
    const updatedAt = new Date().toISOString();
    const nextRecord = {
      ...record,
      updatedAt,
      deliveries: {
        ...record.deliveries,
        [eventId]: { ...delivery, status: toStatus },
      },
    };
    const nextLog = {
      ...log,
      updatedAt,
      attempts: { ...log.attempts, [attemptId]: nextRecord },
    };
    await durableWriteJson(filePath, nextLog);
    return { applied: true, status: toStatus };
  });
}

// pending → posted: the response was written to the live transport / response file.
export async function markPosted({ workspaceRoot, attemptId, eventId } = {}) {
  return transitionDelivery({ workspaceRoot, attemptId, eventId }, "posted");
}

// posted (or pending) → consumed: a provider / waitForUserInputResponse confirmed
// it actually read the response. Only now is the delivery durably done.
export async function markConsumed({ workspaceRoot, attemptId, eventId } = {}) {
  return transitionDelivery({ workspaceRoot, attemptId, eventId }, "consumed");
}

// pending/posted → canceled: the downstream event was superseded; never re-post.
export async function markCanceled({ workspaceRoot, attemptId, eventId } = {}) {
  return transitionDelivery({ workspaceRoot, attemptId, eventId }, "canceled");
}

// Re-post targets across all attempts: BOTH pending and posted (a posted delivery
// may have been lost in a crash before it was consumed). consumed + canceled excluded.
export async function pendingDeliveries({ workspaceRoot } = {}) {
  const log = await loadAttemptLog({ workspaceRoot });
  const out = [];
  for (const record of Object.values(log.attempts)) {
    const deliveries = record.deliveries || {};
    for (const [eventId, delivery] of Object.entries(deliveries)) {
      if (delivery && (delivery.status === "pending" || delivery.status === "posted")) {
        out.push({
          attemptId: record.attemptId,
          eventId,
          status: delivery.status,
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

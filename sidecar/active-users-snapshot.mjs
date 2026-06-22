/**
 * Active-user snapshot store (spec §15.4 — P0-6).
 *
 * One HogQL query against the user's product PostHog: cumulative unique
 * users who completed the `first_value` core activation event (§3.1, D1 —
 * the ONLY high-trust path to the active-user count; visits/signups/
 * screenshots never count). Snapshots persist to
 * `<ws>/.agentic30/metrics/active-users.json` and feed the G4② gate input
 * (`first_value_observed`) plus the "active N/100" counter (§18, P2).
 *
 * Collection piggybacks on the morning-briefing cycle (once per day); this
 * module dedupes same-day snapshots by replacing the last entry for the day.
 *
 * When PostHog is not configured/valid the collector falls through to the
 * §6.1 "explicitly implemented equivalent source adapter": cumulative unique
 * identities drawn ONLY from proof-ledger evidence that is BOTH (a) completed
 * (accepted/verified) AND (b) tagged as a `first_value`/active_user/core
 * activation completion with a unique identity. Inference, signup counts,
 * visits, and self-report never produce a count (VALUES #2); a
 * `manual_proof_required`/submitted/provisional event is NOT verified and is
 * excluded (spec §6.1 line 251, §21 line 1148). The snapshot is tagged
 * `equivalent_verified_evidence`. When neither source yields a count the
 * collector still reports `source_unavailable` and writes nothing — the Gate
 * Engine then treats G4② per §21 (blocked + provisional overlay), never as a
 * pass.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import { resolveAgentic30Dir } from "./news-market-radar.mjs";
import { resolvePostHogMcpSettings } from "./posthog-mcp-config.mjs";
import { loadProofLedger } from "./execution-os.mjs";

export const ACTIVE_USERS_SCHEMA_VERSION = 1;
export const ACTIVE_USERS_SCHEMA = "agentic30.active_users.v1";
// Day 14 Measurement mission instruments an event literally named
// `first_value` (IDD Day 14, spec §3.1) — adopted as the default name.
export const DEFAULT_FIRST_VALUE_EVENT = "first_value";

// §6.1 equivalent source adapter tag. The snapshot `source` distinguishes the
// approved equivalent adapter from `posthog_hogql` so downstream readers never
// confuse a proof-derived count for the live HogQL count (invariant: explicit
// source tagging, not inferred counts).
export const EQUIVALENT_VERIFIED_SOURCE = "equivalent_verified_evidence";
// Only a COMPLETED proof event (accepted/verified) qualifies. A
// `manual_proof_required`/submitted/provisional event is excluded — it is not
// yet verified (spec §6.1 line 251; §21 line 1148).
const VERIFIED_PROOF_STATUSES = new Set(["accepted", "verified", "complete", "completed"]);
// Evidence kinds that certify a `first_value`/core-activation completion. The
// proof event must self-identify as one of these via metadata.kind /
// metadata.activation / evidenceType — a generic action_evidence row without
// this marker never counts as an active user.
const ACTIVE_USER_EVIDENCE_KINDS = new Set([
  "first_value",
  "active_user",
  "active_user_evidence",
  "core_activation",
  "activation_completion",
]);

const SNAPSHOT_LIMIT = 200;
const QUERY_TIMEOUT_MS = 15_000;

export function resolveActiveUsersPath(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "metrics", "active-users.json");
}

export function makeDefaultActiveUsersStore(now = new Date()) {
  const generatedAt = toIso(now);
  return {
    schemaVersion: ACTIVE_USERS_SCHEMA_VERSION,
    schema_version: ACTIVE_USERS_SCHEMA_VERSION,
    schema: ACTIVE_USERS_SCHEMA,
    createdAt: generatedAt,
    created_at: generatedAt,
    updatedAt: generatedAt,
    updated_at: generatedAt,
    snapshots: [],
  };
}

export async function loadActiveUsersStore({ workspaceRoot, fsImpl = fs } = {}) {
  if (!workspaceRoot) return makeDefaultActiveUsersStore();
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveActiveUsersPath(workspaceRoot), "utf8"));
    return normalizeActiveUsersStore(raw);
  } catch {
    return makeDefaultActiveUsersStore();
  }
}

export function normalizeActiveUsersStore(value = {}) {
  const raw = objectOrEmpty(value);
  const fallback = makeDefaultActiveUsersStore();
  const createdAt = normalizeIso(raw.createdAt ?? raw.created_at, fallback.createdAt);
  const snapshots = asArray(raw.snapshots)
    .map(normalizeSnapshot)
    .filter(Boolean)
    .slice(-SNAPSHOT_LIMIT);
  return {
    schemaVersion: ACTIVE_USERS_SCHEMA_VERSION,
    schema_version: ACTIVE_USERS_SCHEMA_VERSION,
    schema: ACTIVE_USERS_SCHEMA,
    createdAt,
    created_at: createdAt,
    updatedAt: normalizeIso(raw.updatedAt ?? raw.updated_at, snapshots.at(-1)?.at ?? createdAt),
    updated_at: normalizeIso(raw.updatedAt ?? raw.updated_at, snapshots.at(-1)?.at ?? createdAt),
    snapshots,
  };
}

/** Cumulative unique users with ≥1 first_value event (§3.1: 누적 카운트). */
export function buildFirstValueCountQuery({ eventName = DEFAULT_FIRST_VALUE_EVENT } = {}) {
  // ClickHouse string literals honor backslash escapes — escape backslashes
  // BEFORE quotes so a trailing "\\" cannot neutralize the closing quote.
  const escaped = String(eventName || DEFAULT_FIRST_VALUE_EVENT)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "''");
  return `SELECT count(DISTINCT person_id) AS users FROM events WHERE event = '${escaped}'`;
}

/**
 * Runs the snapshot query and persists the result. Returns
 * `{ status: "ok"|"source_unavailable"|"query_failed", snapshot, store }`.
 * Nothing is written on unavailability/failure (fail-closed for G4②).
 */
export async function collectActiveUserSnapshot({
  workspaceRoot,
  day = null,
  eventName = DEFAULT_FIRST_VALUE_EVENT,
  env = process.env,
  appSupportPath = "",
  settings = null,
  fetchImpl = fetch,
  proofLedger = null,
  now = new Date(),
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("collectActiveUserSnapshot requires workspaceRoot.");
  }
  const resolved = settings ?? resolvePostHogMcpSettings({ env, appSupportPath });
  // PostHog stays the high-trust path (§6.1, unchanged). When its token is not
  // valid, fall through to the equivalent verified-evidence adapter BEFORE
  // declaring the source unavailable.
  if (!resolved?.tokenValid) {
    return collectEquivalentActiveUserSnapshot({ workspaceRoot, day, proofLedger, now });
  }
  const host = resolved.region === "eu" ? "https://eu.posthog.com" : "https://us.posthog.com";
  const query = buildFirstValueCountQuery({ eventName });
  let count = null;
  try {
    const results = await runHogql({ fetchImpl, host, token: resolved.token, query });
    const value = Number(results?.[0]?.[0]);
    count = Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
  } catch {
    return { status: "query_failed", snapshot: null, store: null };
  }
  if (count === null) {
    return { status: "query_failed", snapshot: null, store: null };
  }
  const snapshot = {
    at: toIso(now),
    day: normalizeDay(day),
    activeUserCount: count,
    active_user_count: count,
    firstValueEventName: String(eventName || DEFAULT_FIRST_VALUE_EVENT),
    first_value_event_name: String(eventName || DEFAULT_FIRST_VALUE_EVENT),
    source: "posthog_hogql",
    queryFingerprint: fingerprint(query),
    query_fingerprint: fingerprint(query),
  };
  const store = await appendActiveUserSnapshot({ workspaceRoot, snapshot, now });
  return { status: "ok", snapshot, store };
}

/**
 * §6.1 approved equivalent source adapter. Reads the proof ledger and counts
 * cumulative UNIQUE identities among proof events that are BOTH completed
 * (accepted/verified — `manual_proof_required`/submitted/provisional are
 * excluded, spec §6.1 line 251) AND tagged as a `first_value`/active_user/core
 * activation completion carrying a unique identity. Returns the same shape as
 * `collectActiveUserSnapshot` with `source: "equivalent_verified_evidence"`.
 *
 * When no verified evidence yields a count, fails closed with
 * `source_unavailable` and writes nothing — the Gate Engine then treats G4②/G5
 * as blocked + provisional, never as a pass. A provisional/self-report row can
 * never bump the count: only verified evidence does (invariant: verified
 * sources only; manual_proof_required ≠ pass).
 */
export async function collectEquivalentActiveUserSnapshot({
  workspaceRoot,
  day = null,
  proofLedger = null,
  now = new Date(),
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("collectEquivalentActiveUserSnapshot requires workspaceRoot.");
  }
  let ledger = proofLedger;
  if (!ledger) {
    try {
      ledger = await loadProofLedger({ workspaceRoot });
    } catch {
      return { status: "source_unavailable", snapshot: null, store: null };
    }
  }
  const count = countVerifiedActiveUserIdentities(ledger);
  // No verified evidence → honest source-unavailable (never an inferred zero
  // count that would masquerade as a real reading).
  if (count === null) {
    return { status: "source_unavailable", snapshot: null, store: null };
  }
  const snapshot = {
    at: toIso(now),
    day: normalizeDay(day),
    activeUserCount: count,
    active_user_count: count,
    firstValueEventName: DEFAULT_FIRST_VALUE_EVENT,
    first_value_event_name: DEFAULT_FIRST_VALUE_EVENT,
    source: EQUIVALENT_VERIFIED_SOURCE,
    queryFingerprint: "",
    query_fingerprint: "",
  };
  const store = await appendActiveUserSnapshot({ workspaceRoot, snapshot, now });
  return { status: "ok", snapshot, store };
}

/**
 * Cumulative count of UNIQUE verified active-user identities in the proof
 * ledger, or null when no proof event qualifies (so the caller can report
 * source-unavailable instead of a misleading zero). Distinct-identity keying
 * keeps the count idempotent — re-verifying the same person's activation never
 * double-counts (invariant #4).
 */
export function countVerifiedActiveUserIdentities(proofLedger = {}) {
  const events = Array.isArray(proofLedger?.events) ? proofLedger.events : [];
  const identities = new Set();
  for (const event of events) {
    if (!isVerifiedActiveUserEvidence(event)) continue;
    const identity = resolveActiveUserIdentity(event);
    if (!identity) continue;
    identities.add(identity);
  }
  if (identities.size === 0) return null;
  return identities.size;
}

function isVerifiedActiveUserEvidence(event = {}) {
  if (!event || typeof event !== "object") return false;
  const status = String(event.status ?? event.validationStatus ?? "").toLowerCase();
  if (!VERIFIED_PROOF_STATUSES.has(status)) return false;
  const kinds = [
    event.metadata?.kind,
    event.metadata?.activation,
    event.metadata?.activationKind,
    event.metadata?.activation_kind,
    event.evidenceType,
    event.evidence_type,
  ];
  return kinds.some((value) =>
    ACTIVE_USER_EVIDENCE_KINDS.has(String(value ?? "").toLowerCase()),
  );
}

function resolveActiveUserIdentity(event = {}) {
  const candidate = event.metadata?.identity
    ?? event.metadata?.personId
    ?? event.metadata?.person_id
    ?? event.metadata?.userId
    ?? event.metadata?.user_id
    ?? event.customer
    ?? event.sourceUrl
    ?? event.source_url
    ?? event.artifactPath
    ?? event.artifact_path;
  return cleanString(candidate, 200);
}

/** Appends a snapshot, replacing any prior snapshot from the same UTC day. */
export async function appendActiveUserSnapshot({ workspaceRoot, snapshot, now = new Date() } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("appendActiveUserSnapshot requires workspaceRoot.");
  }
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) throw new Error("appendActiveUserSnapshot requires a valid snapshot.");
  const filePath = resolveActiveUsersPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const store = await loadActiveUsersStore({ workspaceRoot });
    const dateKey = normalized.at.slice(0, 10);
    const kept = store.snapshots.filter((entry) => entry.at.slice(0, 10) !== dateKey);
    const next = normalizeActiveUsersStore({
      ...store,
      updatedAt: toIso(now),
      snapshots: [...kept, normalized],
    });
    await atomicWriteJson(filePath, next);
    return next;
  });
}

/**
 * G4② input (program-gate-engine `firstValue`): latest snapshot mapped to
 * `{ observed, rowCount, checkedAt }`, or null when no snapshot exists yet
 * (the engine then treats the source as unreported — §21).
 */
export async function latestFirstValueSignal({ workspaceRoot } = {}) {
  const store = await loadActiveUsersStore({ workspaceRoot });
  const latest = store.snapshots.at(-1);
  if (!latest) return null;
  return {
    observed: latest.activeUserCount >= 1,
    rowCount: latest.activeUserCount,
    checkedAt: latest.at,
    firstValueEventName: latest.firstValueEventName,
  };
}

async function runHogql({ fetchImpl, host, token, query }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${host}/api/projects/@current/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.results)) {
      throw new Error(`PostHog query failed: ${payload?.detail || payload?.error || "no results"}`);
    }
    return payload.results;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSnapshot(value = {}) {
  const raw = objectOrEmpty(value);
  const at = normalizeIso(raw.at, "");
  const count = Number(raw.activeUserCount ?? raw.active_user_count);
  if (!at || !Number.isFinite(count) || count < 0) return null;
  return {
    at,
    day: normalizeDay(raw.day),
    activeUserCount: Math.trunc(count),
    active_user_count: Math.trunc(count),
    firstValueEventName: cleanString(raw.firstValueEventName ?? raw.first_value_event_name, 120)
      || DEFAULT_FIRST_VALUE_EVENT,
    first_value_event_name: cleanString(raw.firstValueEventName ?? raw.first_value_event_name, 120)
      || DEFAULT_FIRST_VALUE_EVENT,
    source: cleanString(raw.source, 40) || "posthog_hogql",
    queryFingerprint: cleanString(raw.queryFingerprint ?? raw.query_fingerprint, 64),
    query_fingerprint: cleanString(raw.queryFingerprint ?? raw.query_fingerprint, 64),
  };
}

function fingerprint(query) {
  return createHash("sha256").update(String(query)).digest("hex").slice(0, 16);
}

function normalizeDay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const day = Math.trunc(number);
  return day >= 0 && day <= 400 ? day : null;
}

function normalizeIso(value, fallback) {
  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return fallback;
}

function cleanString(value = "", maxLength = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

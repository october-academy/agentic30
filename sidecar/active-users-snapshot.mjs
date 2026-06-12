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
 * Fail-closed: when the PostHog source is not configured/valid the collector
 * reports `source_unavailable` and writes nothing — the Gate Engine then
 * treats G4② per §21 (blocked + provisional overlay), never as a pass.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import { resolveAgentic30Dir } from "./news-market-radar.mjs";
import { resolvePostHogMcpSettings } from "./posthog-mcp-config.mjs";

export const ACTIVE_USERS_SCHEMA_VERSION = 1;
export const ACTIVE_USERS_SCHEMA = "agentic30.active_users.v1";
// Day 14 Measurement mission instruments an event literally named
// `first_value` (IDD Day 14, spec §3.1) — adopted as the default name.
export const DEFAULT_FIRST_VALUE_EVENT = "first_value";

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
  now = new Date(),
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("collectActiveUserSnapshot requires workspaceRoot.");
  }
  const resolved = settings ?? resolvePostHogMcpSettings({ env, appSupportPath });
  if (!resolved?.tokenValid) {
    return { status: "source_unavailable", snapshot: null, store: null };
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

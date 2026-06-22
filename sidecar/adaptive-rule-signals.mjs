/**
 * Adaptive-rule signal assembly (spec §12 — P1-2).
 *
 * Derives the MVP rule inputs from PERSISTED stores only (proof-ledger,
 * office-hours ledger, work-history snapshot, day-progress) so evaluation is
 * deterministic and replayable. Signals that would need a live external
 * source (Cloudflare visits for AR-08) report their source as unavailable —
 * §12 오탐대응 ③ keeps those rules silent (fail-closed). Missing persisted
 * curriculum or traffic signals never fire a rule.
 */

import path from "node:path";

import { loadProofLedger, PROOF_EVENT_TYPES } from "./execution-os.mjs";
import { loadOfficeHoursMemory } from "./office-hours-memory.mjs";
import { loadWorkHistorySnapshot } from "./work-history.mjs";
import { loadDayProgress } from "./day-progress-state.mjs";
import { loadCurriculumProgressState } from "./adaptive-curriculum.mjs";
import { resolveAgentic30Dir } from "./news-market-radar.mjs";

const SUBMITTED_STATUSES = new Set(["submitted", "accepted", "verified", "complete", "completed"]);
const COMPLETED_STATUSES = new Set(["accepted", "verified", "complete", "completed"]);
const CLOSED_CARRY_OVER_STATUSES = new Set(["accepted", "cancelled", "canceled", "closed", "complete", "completed", "done", "resolved", "verified"]);
const CUSTOMER_CONTACT_TYPES = new Set([
  PROOF_EVENT_TYPES.interview,
  PROOF_EVENT_TYPES.dmAsk,
  PROOF_EVENT_TYPES.paymentIntent,
  PROOF_EVENT_TYPES.paymentRecord,
]);
const NON_EVIDENCE_TYPES = new Set([
  PROOF_EVENT_TYPES.setup,
  PROOF_EVENT_TYPES.mission,
  PROOF_EVENT_TYPES.trafficSnapshot,
]);
const MAX_LOOKBACK_DAYS = 7;

export async function assembleAdaptiveRuleSignals({
  workspaceRoot,
  day,
  now = new Date(),
} = {}) {
  const currentDay = normalizeDay(day);
  if (!workspaceRoot || currentDay === null) {
    return { signals: {}, sources: { cloudflareAvailable: null } };
  }
  const [ledger, memory, workHistory, progress, curriculumProgress] = await Promise.all([
    loadProofLedger({ workspaceRoot }),
    loadOfficeHoursMemory({ workspaceRoot }),
    loadWorkHistorySnapshot({ workspaceRoot, now }),
    loadDayProgress({ workspaceRoot }),
    loadCurriculumProgressState(resolveCurriculumProgressPath(workspaceRoot)),
  ]);
  const events = ledger.events;

  // AR-14: revenue funnel break (proof-ledger derived — no external source).
  const paymentIntentCount = countByType(events, PROOF_EVENT_TYPES.paymentIntent, SUBMITTED_STATUSES);
  const paymentRecordCount = countByType(events, PROOF_EVENT_TYPES.paymentRecord, SUBMITTED_STATUSES);
  const paymentFailureCount = countByType(events, PROOF_EVENT_TYPES.paymentFailure, SUBMITTED_STATUSES);

  // AR-02: weekly strong-interview quota (week = ceil(day / 7), §12).
  const weekNumber = Math.min(4, Math.max(1, Math.ceil(currentDay / 7)));
  const weekStart = (weekNumber - 1) * 7 + 1;
  const weekEnd = weekNumber * 7;
  const weeklyInterviewStrongCount = events.filter((event) =>
    event.type === PROOF_EVENT_TYPES.interview
      && event.strength === "strong"
      && COMPLETED_STATUSES.has(String(event.status || ""))
      && Number(event.day) >= weekStart
      && Number(event.day) <= weekEnd,
  ).length;

  // AR-07: consecutive days (ending today) whose evidence is weak-only.
  // Days without any evidence break the run — carry-over days are not
  // self-report days (§9.3).
  let weakOnlyEvidenceDays = 0;
  for (let d = currentDay; d > Math.max(0, currentDay - MAX_LOOKBACK_DAYS); d -= 1) {
    const dayEvidence = events.filter((event) =>
      Number(event.day) === d
        && !NON_EVIDENCE_TYPES.has(event.type)
        && SUBMITTED_STATUSES.has(String(event.status || "")),
    );
    if (!dayEvidence.length) break;
    if (dayEvidence.some((event) => event.strength !== "weak")) break;
    weakOnlyEvidenceDays += 1;
  }

  // AR-17: stacked promises over abandoned ones (2사이클 무증거, §12).
  const commitments = Array.isArray(memory?.commitments) ? memory.commitments : [];
  const abandoned = commitments.filter((commitment) =>
    commitment?.status === "open"
      && !hasCommitmentEvidence(commitment)
      && currentDay - Number(commitment.createdDay ?? commitment.cycle ?? currentDay) >= 2,
  );
  const latestAbandonedDay = abandoned.reduce(
    (max, commitment) => Math.max(max, Number(commitment.createdDay ?? commitment.cycle ?? 0)),
    0,
  );
  const newCommitmentsSinceAbandoned = abandoned.length
    ? commitments.filter((commitment) =>
        Number(commitment.createdDay ?? commitment.cycle ?? 0) > latestAbandonedDay,
      ).length
    : 0;

  // AR-19: stalled day loop while the app keeps running. This code executes
  // inside the sidecar, so app activity is observed directly.
  const daysSinceDayProgressUpdate = computeDaysSinceProgressUpdate(progress, now);

  // AR-01: build escape — development activity (work-history commits or AI
  // minutes) on a program day with zero customer-contact proof events.
  const buildWithoutCustomerEvidenceDays = computeBuildEscapeDays({
    workHistory,
    events,
    progress,
    currentDay,
  });
  const maxActionCarryOverCount = computeMaxActionCarryOverCount(curriculumProgress);
  const trafficSignals = computeTrafficSignals({ events, currentDay });

  return {
    signals: {
      buildWithoutCustomerEvidenceDays,
      weekNumber,
      weeklyInterviewStrongCount,
      weakOnlyEvidenceDays,
      paymentIntentCount,
      paymentRecordCount,
      paymentFailureCount,
      abandonedThreadCount: abandoned.length,
      newCommitmentsSinceAbandoned,
      daysSinceDayProgressUpdate,
      appActive: true,
      maxActionCarryOverCount,
      deployVerifiedUrlExists: trafficSignals.deployVerifiedUrlExists,
      cloudflareVisitsZeroDays: trafficSignals.cloudflareVisitsZeroDays,
    },
    sources: {
      cloudflareAvailable: trafficSignals.cloudflareAvailable,
    },
  };
}

function resolveCurriculumProgressPath(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "curriculum-progress.json");
}

function countByType(events, type, statuses) {
  return events.filter((event) =>
    event.type === type && statuses.has(String(event.status || "")),
  ).length;
}

function hasCommitmentEvidence(commitment) {
  const evidence = commitment?.evidence;
  if (!evidence || typeof evidence !== "object") return false;
  return Boolean(evidence.kind || evidence.url || evidence.note || evidence.recordedAt);
}

function computeMaxActionCarryOverCount(curriculumProgress) {
  const entries = collectCarryOverEntries(curriculumProgress);
  if (!entries.length) return null;
  let max = null;
  for (const entry of entries) {
    const rawStatus = String(entry.carryOverStatus ?? entry.carry_over_status ?? entry.status ?? "").toLowerCase();
    if (CLOSED_CARRY_OVER_STATUSES.has(rawStatus)) continue;
    const count = normalizeNonNegativeInt(entry.timesCarried ?? entry.times_carried);
    max = Math.max(max ?? 0, count ?? 1);
  }
  return max;
}

function collectCarryOverEntries(curriculumProgress) {
  const root = curriculumProgress && typeof curriculumProgress === "object" ? curriculumProgress : {};
  const candidates = [
    root.carryOverQueue,
    root.carry_over_queue,
    ...asArray(root.dayRecords ?? root.day_records).flatMap((record) => [
      record?.carryOverQueue,
      record?.carry_over_queue,
    ]),
  ].flatMap(asArray);
  const seen = new Set();
  const entries = [];
  for (const entry of candidates) {
    if (!entry || typeof entry !== "object") continue;
    const key = [
      entry.id,
      entry.actionId ?? entry.action_id,
      entry.sourceDay ?? entry.source_day,
      entry.targetDay ?? entry.target_day,
      entry.actionDescription ?? entry.action_description,
    ].filter((value) => value !== undefined && value !== null && value !== "").join(":");
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    entries.push(entry);
  }
  return entries;
}

function computeTrafficSignals({ events, currentDay }) {
  const snapshots = events
    .filter((event) =>
      event.type === PROOF_EVENT_TYPES.trafficSnapshot
        && COMPLETED_STATUSES.has(String(event.status || ""))
        && Number.isFinite(Number(event.day)),
    )
    .map((event) => ({
      event,
      day: Number(event.day),
      visits: trafficVisitCount(event),
      hasDeployUrl: hasDeployUrl(event),
    }))
    .filter((entry) => entry.visits !== null);

  if (!snapshots.length) {
    return {
      cloudflareAvailable: null,
      deployVerifiedUrlExists: null,
      cloudflareVisitsZeroDays: null,
    };
  }

  const byDay = new Map();
  for (const snapshot of snapshots) {
    const existing = byDay.get(snapshot.day);
    if (!existing || snapshot.visits > existing.visits) byDay.set(snapshot.day, snapshot);
  }

  let zeroDays = 0;
  for (let d = currentDay; d > Math.max(0, currentDay - MAX_LOOKBACK_DAYS); d -= 1) {
    const snapshot = byDay.get(d);
    if (!snapshot || snapshot.visits !== 0) break;
    zeroDays += 1;
  }

  return {
    cloudflareAvailable: true,
    deployVerifiedUrlExists: snapshots.some((snapshot) => snapshot.hasDeployUrl),
    cloudflareVisitsZeroDays: zeroDays,
  };
}

function trafficVisitCount(event) {
  const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  const counts = metadata.counts && typeof metadata.counts === "object" ? metadata.counts : {};
  return normalizeNonNegativeInt(
    event?.visits
      ?? event?.visitCount
      ?? event?.visit_count
      ?? counts.visits
      ?? counts.uniqueVisitors
      ?? counts.unique_visitors
      ?? metadata.visits
      ?? metadata.uniqueVisitors
      ?? metadata.unique_visitors,
  );
}

function hasDeployUrl(event) {
  const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  return event?.sourceUrl
    || event?.source_url
    || metadata.deployVerifiedUrlExists === true
    || metadata.deploy_verified_url_exists === true
    || metadata.deployUrl
    || metadata.deploy_url
    || metadata.url
    || metadata.sourceUrl
    || metadata.source_url
    ? true
    : null;
}

function computeDaysSinceProgressUpdate(progress, now) {
  const days = progress?.days && typeof progress.days === "object" ? Object.values(progress.days) : [];
  let latest = null;
  for (const record of days) {
    const ts = Date.parse(String(record?.updatedAt ?? record?.updated_at ?? ""));
    if (Number.isFinite(ts) && (latest === null || ts > latest)) latest = ts;
  }
  if (latest === null) return null;
  const diffMs = now.getTime() - latest;
  return diffMs < 0 ? 0 : Math.floor(diffMs / 86_400_000);
}

function computeBuildEscapeDays({ workHistory, events, progress, currentDay }) {
  const startedAt = String(progress?.challengeStartedAt ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startedAt)) return null;
  if (workHistory?.status?.state === "empty") return null;
  const historyDays = Array.isArray(workHistory?.days) ? workHistory.days : [];
  const byDate = new Map(historyDays.map((entry) => [String(entry.date), entry]));
  let consecutive = 0;
  for (let d = currentDay; d > Math.max(0, currentDay - MAX_LOOKBACK_DAYS); d -= 1) {
    const date = programDayToDate(startedAt, d);
    const entry = byDate.get(date);
    if (!entry) break;
    const commitCount = (Array.isArray(entry.areas) ? entry.areas : [])
      .reduce((sum, area) => sum + (Number(area?.commitCount ?? area?.commit_count) || 0), 0);
    const developing = commitCount > 0 || Number(entry.aiMinutes) > 0;
    if (!developing) break;
    const customerContact = events.some((event) =>
      Number(event.day) === d
        && CUSTOMER_CONTACT_TYPES.has(event.type)
        && SUBMITTED_STATUSES.has(String(event.status || "")),
    );
    if (customerContact) break;
    consecutive += 1;
  }
  return consecutive;
}

function normalizeNonNegativeInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const int = Math.trunc(number);
  return int >= 0 ? int : null;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function programDayToDate(startedAt, day) {
  const [year, month, dayOfMonth] = startedAt.split("-").map(Number);
  const base = new Date(year, month - 1, dayOfMonth);
  base.setDate(base.getDate() + (day - 1));
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return `${base.getFullYear()}-${mm}-${dd}`;
}

function normalizeDay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const day = Math.trunc(number);
  return day >= 1 && day <= 400 ? day : null;
}

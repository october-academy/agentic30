/**
 * Adaptive-rule signal assembly (spec §12 — P1-2).
 *
 * Derives the MVP rule inputs from PERSISTED stores only (proof-ledger,
 * office-hours ledger, work-history snapshot, day-progress) so evaluation is
 * deterministic and replayable. Signals that would need a live external
 * source (Cloudflare visits for AR-08) report their source as unavailable —
 * §12 오탐대응 ③ keeps those rules silent (fail-closed). AR-05's
 * carry-over input arrives when the curriculum loop integration lands; a
 * missing signal never fires a rule.
 */

import { loadProofLedger, PROOF_EVENT_TYPES } from "./execution-os.mjs";
import { loadOfficeHoursMemory } from "./office-hours-memory.mjs";
import { loadWorkHistorySnapshot } from "./work-history.mjs";
import { loadDayProgress } from "./day-progress-state.mjs";

const SUBMITTED_STATUSES = new Set(["submitted", "accepted", "verified", "complete", "completed"]);
const COMPLETED_STATUSES = new Set(["accepted", "verified", "complete", "completed"]);
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
  const [ledger, memory, workHistory, progress] = await Promise.all([
    loadProofLedger({ workspaceRoot }),
    loadOfficeHoursMemory({ workspaceRoot }),
    loadWorkHistorySnapshot({ workspaceRoot, now }),
    loadDayProgress({ workspaceRoot }),
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
      // AR-05 입력은 curriculum 루프 통합 시 carryOverQueue에서 채워진다.
      maxActionCarryOverCount: null,
      // AR-08 입력은 §12-③에 따라 소스 가용 시에만 채워진다.
      deployVerifiedUrlExists: null,
      cloudflareVisitsZeroDays: null,
    },
    sources: {
      cloudflareAvailable: null,
    },
  };
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

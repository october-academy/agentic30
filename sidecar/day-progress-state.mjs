import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import { resolveAgentic30Dir } from "./news-market-radar.mjs";

// Per-Day macro-loop progress: the IA "Day timeline" sidebar + main-column stepper
// read from THIS module only. It is a distinct axis from adaptive-curriculum's
// dayType(interview/action/review/education) record — no fixed-syllabus coupling.
// Schema bumps require a migration test (see day-progress-state.test.mjs).
export const DAY_PROGRESS_SCHEMA_VERSION = 1;
export const DAY_PROGRESS_SCHEMA = "agentic30.day_progress.v1";

// Macro loop stages, gated by Day kind (IA decision: Day1=4 steps, Day2+=5 steps).
export const DAY1_STEPS = Object.freeze(["onboarding", "scan", "goal", "first_interview"]);
export const STANDARD_STEPS = Object.freeze(["scan", "retro", "goal", "interview", "execution"]);

const STEP_STATUSES = new Set(["done", "active", "pending"]);
const DAY_KINDS = new Set(["day1", "standard"]);
const MAX_DAY = 400; // 30-day challenge with generous slack for slipped timelines.

export function resolveDayProgressPath(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "day-progress.json");
}

export function dayKindForDay(day) {
  return Number(day) === 1 ? "day1" : "standard";
}

export function stepDefsForDay(day, kind) {
  const resolved = DAY_KINDS.has(kind) ? kind : dayKindForDay(day);
  return resolved === "day1" ? DAY1_STEPS : STANDARD_STEPS;
}

export async function loadDayProgress({ workspaceRoot, fsImpl = fs } = {}) {
  if (!workspaceRoot) return null;
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveDayProgressPath(workspaceRoot), "utf8"));
    return normalizeDayProgress(raw);
  } catch {
    return null;
  }
}

export async function saveDayProgress({ workspaceRoot, progress, now = new Date() } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("day_progress_save requires workspaceRoot.");
  }
  const filePath = resolveDayProgressPath(workspaceRoot);
  const normalized = normalizeDayProgress(progress, { now });
  return withFileLock(filePath, async () => {
    await atomicWriteJson(filePath, normalized);
    return normalized;
  });
}

// Record the challenge start date exactly once (local YYYY-MM-DD). Day numbers
// are elapsed-days-from-start (IA decision), so this is the single source.
export async function ensureChallengeStart({ workspaceRoot, now = new Date() } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("ensureChallengeStart requires workspaceRoot.");
  }
  const filePath = resolveDayProgressPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const current = (await loadDayProgress({ workspaceRoot })) ?? makeDefaultDayProgress();
    if (current.challengeStartedAt) {
      return current;
    }
    current.challengeStartedAt = localDateKey(now);
    const normalized = normalizeDayProgress(current, { now });
    await atomicWriteJson(filePath, normalized);
    return normalized;
  });
}

// Explicit per-step patch (decision: explicit patch, not inferred). Auto-records
// challengeStartedAt on first write so elapsed-day math always has an anchor.
export async function patchDayStep({
  workspaceRoot,
  day,
  stepId,
  status,
  goalText,
  kind,
  now = new Date(),
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("day_progress_patch requires workspaceRoot.");
  }
  const dayNum = normalizeDayInt(day);
  if (!dayNum) {
    throw new Error("day_progress_patch requires a valid day number.");
  }
  const dayKind = DAY_KINDS.has(kind) ? kind : dayKindForDay(dayNum);
  const defs = stepDefsForDay(dayNum, dayKind);
  if (!defs.includes(stepId)) {
    throw new Error(`day_progress_patch: unknown step "${stepId}" for ${dayKind} Day ${dayNum}.`);
  }
  const nextStatus = normalizeStatus(status);

  const filePath = resolveDayProgressPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const current = (await loadDayProgress({ workspaceRoot })) ?? makeDefaultDayProgress();
    if (!current.challengeStartedAt) {
      current.challengeStartedAt = localDateKey(now);
    }
    const key = String(dayNum);
    const record = current.days[key] ?? makeDayRecord(dayNum, dayKind, now);
    record.kind = dayKind;
    record.steps = { ...record.steps, [stepId]: nextStatus };
    if (typeof goalText === "string") {
      record.goalText = cleanString(goalText, 200);
    }
    record.updatedAt = now.toISOString();
    current.days[key] = record;
    const normalized = normalizeDayProgress(current, { now });
    await atomicWriteJson(filePath, normalized);
    return normalized;
  });
}

// Advance the day loop to `stepId`: mark it active and every earlier step done.
// MONOTONIC — never regresses: if the record is already further along than
// `stepId`, the furthest reached step stays active (earlier-stage events like a
// re-scan can't undo later progress). Earlier stages with no dedicated screen in
// the current scope (onboarding/retro) are auto-completed when the loop passes them.
export async function setDayActiveStep({
  workspaceRoot,
  day,
  stepId,
  goalText,
  now = new Date(),
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("setDayActiveStep requires workspaceRoot.");
  }
  const dayNum = normalizeDayInt(day);
  if (!dayNum) {
    throw new Error("setDayActiveStep requires a valid day number.");
  }
  const kind = dayKindForDay(dayNum);
  const defs = stepDefsForDay(dayNum, kind);
  if (!defs.includes(stepId)) {
    throw new Error(`setDayActiveStep: unknown step "${stepId}" for ${kind} Day ${dayNum}.`);
  }

  const filePath = resolveDayProgressPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const current = (await loadDayProgress({ workspaceRoot })) ?? makeDefaultDayProgress();
    if (!current.challengeStartedAt) {
      current.challengeStartedAt = localDateKey(now);
    }
    const key = String(dayNum);
    const record = current.days[key] ?? makeDayRecord(dayNum, kind, now);
    record.kind = kind;
    record.steps = applyActiveStep(record.steps, defs, stepId);
    if (typeof goalText === "string" && goalText.trim()) {
      record.goalText = cleanString(goalText, 200);
    }
    record.updatedAt = now.toISOString();
    current.days[key] = record;
    const normalized = normalizeDayProgress(current, { now });
    await atomicWriteJson(filePath, normalized);
    return normalized;
  });
}

function applyActiveStep(steps, defs, stepId) {
  const targetIdx = defs.indexOf(stepId);
  if (targetIdx < 0) return { ...steps };
  // Furthest step already touched (done/active) — never regress behind it.
  let furthest = -1;
  defs.forEach((id, i) => {
    if (steps[id] === "done" || steps[id] === "active") furthest = i;
  });
  const activeIdx = Math.max(targetIdx, furthest);
  const next = { ...steps };
  defs.forEach((id, i) => {
    if (i < activeIdx) {
      next[id] = "done";
    } else if (i === activeIdx) {
      next[id] = next[id] === "done" ? "done" : "active";
    } else {
      next[id] = next[id] ?? "pending";
    }
  });
  return next;
}

// Elapsed-days-from-start + 1 (start day = Day 1), compared on LOCAL calendar
// dates only (decision: local YYYY-MM-DD) — consistent with work-history
// wall-clock/day-split. Returns null when no challenge start is recorded yet.
export function computeDayNumber({ challengeStartedAt, now = new Date() } = {}) {
  const startParts = parseDateKey(challengeStartedAt);
  if (!startParts) return null;
  const start = new Date(startParts.y, startParts.m - 1, startParts.d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - start.getTime()) / 86_400_000);
  return diffDays >= 0 ? diffDays + 1 : 1;
}

export function normalizeDayProgress(value = {}, { now = new Date() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return makeDefaultDayProgress();
  }
  const rawStart = value.challengeStartedAt ?? value.challenge_started_at;
  const challengeStartedAt = rawStart ? normalizeDateKey(rawStart) : null;

  const daysIn = value.days && typeof value.days === "object" && !Array.isArray(value.days)
    ? value.days
    : {};
  const days = {};
  for (const [key, rec] of Object.entries(daysIn)) {
    const norm = normalizeDayRecord(rec, { now, fallbackDay: Number(key) });
    if (norm) days[String(norm.day)] = norm;
  }
  return {
    schemaVersion: DAY_PROGRESS_SCHEMA_VERSION,
    schema: DAY_PROGRESS_SCHEMA,
    challengeStartedAt,
    days,
  };
}

export function normalizeDayRecord(value = {}, { now = new Date(), fallbackDay } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const day = normalizeDayInt(value.day ?? value.dayId ?? value.day_id ?? fallbackDay);
  if (!day) return null;
  const kind = DAY_KINDS.has(value.kind) ? value.kind : dayKindForDay(day);
  const defs = stepDefsForDay(day, kind);
  const stepsIn = value.steps && typeof value.steps === "object" && !Array.isArray(value.steps)
    ? value.steps
    : {};
  const steps = {};
  for (const stepId of defs) {
    steps[stepId] = normalizeStatus(stepsIn[stepId]);
  }
  const rawGoalText = cleanString(value.goalText ?? value.goal_text, 500);
  const goalText = day > 1 && looksLikeLegacyDay1GoalText(rawGoalText)
    ? ""
    : repairLegacyDay1GoalText(rawGoalText);
  return {
    day,
    kind,
    steps,
    goalText,
    updatedAt: normalizeIsoDate(value.updatedAt ?? value.updated_at, now),
  };
}

function makeDefaultDayProgress() {
  return {
    schemaVersion: DAY_PROGRESS_SCHEMA_VERSION,
    schema: DAY_PROGRESS_SCHEMA,
    challengeStartedAt: null,
    days: {},
  };
}

function makeDayRecord(day, kind, now) {
  const steps = {};
  for (const stepId of stepDefsForDay(day, kind)) {
    steps[stepId] = "pending";
  }
  return { day, kind, steps, goalText: "", updatedAt: now.toISOString() };
}

function normalizeStatus(value) {
  const token = String(value || "").trim().toLowerCase();
  return STEP_STATUSES.has(token) ? token : "pending";
}

function normalizeDayInt(value) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || num < 1 || num > MAX_DAY) return null;
  return num;
}

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

// Keep only the date portion (YYYY-MM-DD) — accepts a bare date or an ISO timestamp.
function normalizeDateKey(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function normalizeIsoDate(value, fallbackDate) {
  const timestamp = Date.parse(String(value || ""));
  if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  return fallbackDate.toISOString();
}

function cleanString(value = "", maxLength = 200) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function looksLikeLegacyDay1GoalText(text = "") {
  const value = cleanString(text, 500);
  return /에 돈이나 시간을 쓸지 .+으로 확인한다[.。]?$/u.test(value)
    || /를 실제 유입\/가입 행동으로 모아 .+ 반복 여부를 확인한다[.。]?$/u.test(value)
    || /을 해결하는 제품 흐름에서 막히는 지점을 .+으로 확인한다[.。]?$/u.test(value);
}

function repairLegacyDay1GoalText(text = "") {
  const value = cleanString(text, 500);
  let match = value.match(/^(.+?)가 (.+?)에 돈이나 시간을 쓸지 (.+?)으로 확인한다[.。]?$/u);
  if (match) {
    return cleanString(`${match[1]}가 "${stripSentenceTerminal(match[2])}" 문제에 돈이나 시간을 쓸지 확인한다. 방법: ${ensureSentence(match[3])}`, 200);
  }
  match = value.match(/^(.+?)를 실제 유입\/가입 행동으로 모아 (.+?) 반복 여부를 확인한다[.。]?$/u);
  if (match) {
    return cleanString(`${match[1]}가 "${stripSentenceTerminal(match[2])}" 문제를 실제 유입/가입 행동으로 반복해서 드러내는지 확인한다.`, 200);
  }
  match = value.match(/^(.+?)가 (.+?)을 해결하는 제품 흐름에서 막히는 지점을 (.+?)으로 확인한다[.。]?$/u);
  if (match) {
    return cleanString(`${match[1]}가 "${stripSentenceTerminal(match[2])}" 문제를 해결하는 제품 흐름에서 어디가 막히는지 확인한다. 방법: ${ensureSentence(match[3])}`, 200);
  }
  return cleanString(value, 200);
}

function stripSentenceTerminal(value = "") {
  return cleanString(value, 500).replace(/[.。]+$/u, "").trim();
}

function ensureSentence(value = "") {
  const text = cleanString(value, 500);
  if (!text) return "이번 주 확인할 행동을 정한다.";
  return /[.!?。！？]$/u.test(text) ? text : `${text}.`;
}

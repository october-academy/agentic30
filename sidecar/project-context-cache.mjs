import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson } from "./atomic-store.mjs";
import {
  deriveWorkspaceOnboardingHypothesisLocally,
  mergeWorkspaceOnboardingHypotheses,
  normalizeWorkspaceOnboardingHypothesis,
} from "./onboarding-hypothesis.mjs";
import {
  loadCurriculumAnswerLog,
  resolveAgentic30Dir,
} from "./news-market-radar.mjs";

export const PROJECT_CONTEXT_SCHEMA_VERSION = 1;
export const PROJECT_CONTEXT_SCHEMA = "agentic30.project_context.v1";

const MAX_EVIDENCE_REFS = 12;
const MAX_ANSWER_REFS = 6;

export function resolveProjectContextCachePath(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "project-context.json");
}

export async function loadProjectContextCache({ workspaceRoot, fsImpl = fs } = {}) {
  if (!workspaceRoot) return null;
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveProjectContextCachePath(workspaceRoot), "utf8"));
    const normalized = normalizeProjectContextCache(raw);
    return normalized.schema === PROJECT_CONTEXT_SCHEMA ? normalized : null;
  } catch {
    return null;
  }
}

export async function refreshProjectContextCache({
  workspaceRoot,
  reason = "manual",
  scanResult = null,
  onboardingHypothesis = null,
  completedDay = null,
  docPaths = {},
  now = new Date(),
  fsImpl = fs,
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("refreshProjectContextCache: workspaceRoot is required");
  }
  const previous = await loadProjectContextCache({ workspaceRoot, fsImpl });
  const localHypothesis = onboardingHypothesis
    ? normalizeWorkspaceOnboardingHypothesis(onboardingHypothesis)
    : await deriveWorkspaceOnboardingHypothesisLocally(workspaceRoot, {
        docPaths: scanResult || docPaths || {},
      });
  const mergedHypothesis = mergeWorkspaceOnboardingHypotheses(previous, localHypothesis);
  const answerLog = await loadCurriculumAnswerLog({ workspaceRoot, now, fsImpl }).catch(() => ({ records: [] }));
  const answerRefs = evidenceRefsFromAnswers(answerLog.records, completedDay);
  const evidenceRefs = uniqueStrings([
    ...normalizeEvidenceRefs(mergedHypothesis.evidence),
    ...normalizeEvidenceRefs(previous?.evidenceRefs),
    ...answerRefs,
  ]).slice(0, MAX_EVIDENCE_REFS);
  const cache = normalizeProjectContextCache({
    ...mergedHypothesis,
    schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
    schema: PROJECT_CONTEXT_SCHEMA,
    updatedAt: now.toISOString(),
    lastRefreshReason: cleanToken(reason) || "manual",
    lastCompletedDay: normalizeCompletedDay(completedDay, previous?.lastCompletedDay),
    evidenceRefs,
  });
  cache.sourceFingerprint = fingerprintProjectContext(cache);
  await atomicWriteJson(resolveProjectContextCachePath(workspaceRoot), cache);
  return cache;
}

export function normalizeProjectContextCache(value = {}) {
  const normalized = normalizeWorkspaceOnboardingHypothesis(value);
  const evidenceRefs = normalizeEvidenceRefs(value.evidenceRefs ?? value.evidence_refs ?? normalized.evidence);
  const lastCompletedDay = normalizeCompletedDay(value.lastCompletedDay ?? value.last_completed_day, null);
  return {
    schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
    schema: value.schema === PROJECT_CONTEXT_SCHEMA ? value.schema : PROJECT_CONTEXT_SCHEMA,
    productName: normalized.productName,
    projectKind: normalized.projectKind,
    targetUser: normalized.targetUser,
    problem: normalized.problem,
    purpose: normalized.purpose,
    goal: normalized.goal,
    values: normalized.values,
    likelyUsers: normalized.likelyUsers,
    stage: normalized.stage,
    confidence: normalized.confidence,
    evidenceRefs,
    sourceFingerprint: cleanString(value.sourceFingerprint || value.source_fingerprint || "", 128),
    lastRefreshReason: cleanToken(value.lastRefreshReason ?? value.last_refresh_reason) || "manual",
    lastCompletedDay,
    updatedAt: normalizeIsoDate(value.updatedAt ?? value.updated_at),
  };
}

export function formatProjectContextForPrompt(projectContext, {
  title = "## Source-Derived Project Context",
  missing = "",
} = {}) {
  const context = projectContext ? normalizeProjectContextCache(projectContext) : null;
  if (!context) return missing;
  const rows = [
    ["Product", context.productName],
    ["Kind", context.projectKind && context.projectKind !== "unknown" ? context.projectKind : ""],
    ["Customer / ICP", context.targetUser],
    ["Problem", context.problem],
    ["Purpose", context.purpose],
    ["Goal", context.goal],
    ["Values", context.values],
    ["Likely users", context.likelyUsers?.join(", ")],
    ["Stage", context.stage && context.stage !== "unknown" ? context.stage : ""],
    ["Confidence", context.confidence],
    ["Evidence", context.evidenceRefs?.join(" / ")],
  ].filter(([, value]) => value);
  if (!rows.length) return missing;
  return [
    title,
    "This compact project brief was refreshed during onboarding scan or Day completion. Do not rescan source code during BIP generation.",
    ...rows.map(([label, value]) => `${label}: ${value}`),
  ].join("\n");
}

export function projectContextQuerySeeds(projectContext) {
  const context = projectContext ? normalizeProjectContextCache(projectContext) : null;
  if (!context) return [];
  return uniqueStrings([
    context.targetUser,
    context.problem,
    context.purpose,
    context.goal,
    context.values,
    ...(context.likelyUsers || []),
  ]).slice(0, 8);
}

function evidenceRefsFromAnswers(records = [], completedDay = null) {
  const maxDay = normalizeCompletedDay(completedDay, null);
  return records
    .filter((record) => !maxDay || Number(record.day) <= maxDay)
    .slice(-MAX_ANSWER_REFS)
    .map((record) => {
      const label = [
        `Day ${record.day}`,
        record.dimension,
        record.answerTitle || record.freeformAnswer || record.answerDetail,
      ].filter(Boolean).join(" · ");
      return label.slice(0, 220);
    })
    .filter(Boolean);
}

function fingerprintProjectContext(cache) {
  return createHash("sha256").update(JSON.stringify({
    productName: cache.productName,
    projectKind: cache.projectKind,
    targetUser: cache.targetUser,
    problem: cache.problem,
    purpose: cache.purpose,
    goal: cache.goal,
    values: cache.values,
    likelyUsers: cache.likelyUsers,
    stage: cache.stage,
    confidence: cache.confidence,
    evidenceRefs: cache.evidenceRefs,
    lastRefreshReason: cache.lastRefreshReason,
    lastCompletedDay: cache.lastCompletedDay,
  })).digest("hex");
}

function normalizeEvidenceRefs(values = []) {
  return uniqueStrings(Array.isArray(values) ? values : [values])
    .map((value) => cleanString(value, 260))
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_REFS);
}

function normalizeCompletedDay(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 30) return parsed;
  return fallback ?? null;
}

function normalizeIsoDate(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function cleanToken(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = cleanString(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

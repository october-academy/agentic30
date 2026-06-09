import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import { resolveAgentic30Dir } from "./news-market-radar.mjs";

export const DAY1_GOAL_SCHEMA_VERSION = 1;
export const DAY1_GOAL_SCHEMA = "agentic30.day1_goal.v1";

const GOAL_TYPES = new Set(["make_money", "get_users", "build_product"]);
const PROOF_SINKS = new Set(["local", "bip_optional"]);

export function resolveDay1GoalPath(workspaceRoot) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "day1-goal.json");
}

export async function loadDay1GoalSelection({ workspaceRoot, fsImpl = fs } = {}) {
  if (!workspaceRoot) return null;
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveDay1GoalPath(workspaceRoot), "utf8"));
    return normalizeDay1GoalSelection(raw);
  } catch {
    return null;
  }
}

export async function saveDay1GoalSelection({ workspaceRoot, selection, now = new Date() } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("day1_goal_save requires workspaceRoot.");
  }
  const normalized = normalizeDay1GoalSelection(selection, { now });
  if (!normalized) {
    throw new Error("day1_goal_save requires a valid goal selection.");
  }
  const filePath = resolveDay1GoalPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    await atomicWriteJson(filePath, normalized);
    return normalized;
  });
}

export function normalizeDay1GoalSelection(value = {}, { now = new Date() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const goalType = cleanToken(value.goalType ?? value.goal_type);
  if (!GOAL_TYPES.has(goalType)) return null;

  const rawGoalText = cleanString(value.goalText ?? value.goal_text, 500);
  const rawCustomer = cleanString(value.customer, 300);
  const problem = cleanString(value.problem, 500);
  const validationAction = cleanString(value.validationAction ?? value.validation_action, 500);
  const customer = sanitizeDay1GoalCustomer(rawCustomer, { problem });
  const goalText = sanitizeDay1GoalText(rawGoalText, {
    goalType,
    rawCustomer,
    customer,
    problem,
    validationAction,
  });
  if (!goalText || !customer || !problem || !validationAction) return null;

  const evidenceRefs = normalizeStringArray(value.evidenceRefs ?? value.evidence_refs, 12, 260);
  const proofSink = PROOF_SINKS.has(cleanToken(value.proofSink ?? value.proof_sink))
    ? cleanToken(value.proofSink ?? value.proof_sink)
    : "local";
  const sourcePlanFingerprint = cleanString(
    value.sourcePlanFingerprint ?? value.source_plan_fingerprint ?? fingerprintGoalSource(value),
    128,
  );
  const selectedAt = normalizeIsoDate(value.selectedAt ?? value.selected_at, now);

  return {
    schemaVersion: DAY1_GOAL_SCHEMA_VERSION,
    schema: DAY1_GOAL_SCHEMA,
    goalType,
    goalText,
    customer,
    problem,
    validationAction,
    evidenceRefs,
    proofSink,
    sourcePlanFingerprint,
    selectedAt,
  };
}

export function buildDay1GoalProjectContext(selection = null) {
  const goal = normalizeDay1GoalSelection(selection);
  if (!goal) return null;
  return {
    targetUser: goal.customer,
    problem: goal.problem,
    goal: goal.goalText,
    purpose: goal.validationAction,
    evidence: goal.evidenceRefs,
    confidence: "high",
  };
}

export function fingerprintGoalSource(value = {}) {
  return createHash("sha256").update(JSON.stringify({
    goalType: cleanToken(value.goalType ?? value.goal_type),
    goalText: cleanString(value.goalText ?? value.goal_text, 500),
    customer: cleanString(value.customer, 300),
    problem: cleanString(value.problem, 500),
    validationAction: cleanString(value.validationAction ?? value.validation_action, 500),
    evidenceRefs: normalizeStringArray(value.evidenceRefs ?? value.evidence_refs, 12, 260),
  })).digest("hex");
}

function normalizeIsoDate(value, fallbackDate) {
  const timestamp = Date.parse(String(value || ""));
  if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  return fallbackDate.toISOString();
}

function cleanToken(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeDay1GoalCustomer(value, { problem = "" } = {}) {
  let text = cleanString(value, 300);
  const pain = cleanString(problem, 500);
  if (!text || !pain) return text;
  const escapedPain = escapeRegExp(pain);
  const escapedPainPrefix = escapeRegExp(pain.slice(0, 80));
  text = text
    .replace(new RegExp(`\\s+중\\s*["“]?${escapedPain}["”]?\\s*[….]*(?:\\s*상황.*)?$`, "iu"), "")
    .replace(new RegExp(`\\s+중\\s*["“]?${escapedPainPrefix}.*$`, "iu"), "")
    .trim();
  return cleanString(text || value, 300);
}

function sanitizeDay1GoalText(goalText, {
  goalType,
  rawCustomer,
  customer,
  problem,
  validationAction,
} = {}) {
  const text = cleanString(goalText, 500);
  if (!text) return text;
  const cleanedCustomer = cleanString(customer, 300);
  const originalCustomer = cleanString(rawCustomer, 300);
  if (
    shouldRegenerateDay1GoalText(text, {
      goalType,
      originalCustomer,
      cleanedCustomer,
      problem,
      validationAction,
    })
  ) {
    return buildDay1GoalText({ goalType, customer: cleanedCustomer, problem, validationAction });
  }
  return text;
}

function buildDay1GoalText({ goalType, customer, problem, validationAction } = {}) {
  const target = cleanString(customer, 300);
  const pain = quoteProblem(problem);
  const method = validationMethodSentence(validationAction);
  switch (goalType) {
    case "make_money":
      return `${target}가 ${pain} 문제에 돈이나 시간을 쓸지 확인한다. ${method}`;
    case "get_users":
      return `${target}가 ${pain} 문제를 실제 유입/가입 행동으로 반복해서 드러내는지 확인한다. ${method}`;
    case "build_product":
      return `${target}가 ${pain} 문제를 해결하는 제품 흐름에서 어디가 막히는지 확인한다. ${method}`;
    default:
      return "";
  }
}

function shouldRegenerateDay1GoalText(text, {
  goalType,
  originalCustomer,
  cleanedCustomer,
  problem,
  validationAction,
} = {}) {
  if (
    cleanedCustomer
    && originalCustomer
    && cleanedCustomer !== originalCustomer
    && text.includes(originalCustomer.slice(0, Math.min(originalCustomer.length, 80)))
  ) {
    return true;
  }
  if (/[.!?。！？]\s*으로\s*확인한다[.。]?$/u.test(text)) return true;
  if (/다에\s*돈이나\s*시간을\s*쓸지/u.test(text)) return true;

  const pain = cleanString(problem, 500);
  const action = cleanString(validationAction, 500);
  if (!pain) return false;
  const legacyPatterns = [
    `${pain}에 돈이나 시간을 쓸지`,
    `${pain} 반복 여부를 확인한다`,
    `${pain}을 해결하는 제품 흐름에서 막히는 지점을`,
  ];
  if (legacyPatterns.some((pattern) => text.includes(pattern))) return true;
  if (action && text.includes(`${action}으로 확인한다`)) return true;
  return false;
}

function quoteProblem(value = "") {
  const text = cleanString(value, 500)
    .replace(/^["“”'‘’]+|["“”'‘’]+$/gu, "")
    .replace(/[.。]+$/u, "")
    .trim();
  return `"${text || "검증할 문제"}"`;
}

function validationMethodSentence(value = "") {
  const text = cleanString(value, 500);
  if (!text) return "방법: 이번 주 확인할 행동을 정한다.";
  return `방법: ${/[.!?。！？]$/u.test(text) ? text : `${text}.`}`;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeStringArray(value = [], maxItems = 12, maxLength = 260) {
  const values = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const output = [];
  for (const item of values) {
    const text = cleanString(item, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

import path from "node:path";

import {
  appendAssessment,
  computeWithinPersonDelta,
  loadAssessmentsFromFile,
} from "./rubric-assessment.mjs";
import { RUBRIC_AXES } from "./specialists/schema.mjs";
import { getAnchorText, nearestAnchorLevel } from "./rubric-anchors.mjs";

export const RUBRIC_ASSESSMENT_FILE = ".agentic30/rubric-assessments.json";

// Telemetry payload at this call site is intentionally minimal: { day, axisCount }.
// The underlying telemetry client (sidecar/telemetry.mjs ~line 214) auto-injects
// `distinct_id`, `workspace_basename`, and the authenticated user's email domain.
// Raw scores, anchor_text, evidence_refs, no_evidence_reason, sessionId, and notes
// stay LOCAL — never via telemetry (Codex MEDIUM review: spell out the auto-fields
// so the privacy contract is auditable).
export const TELEMETRY_EVENT_RECORDED = "mac_sidecar_rubric_assessment_recorded";

export function getRubricAssessmentPath(workspaceRoot) {
  if (!workspaceRoot) {
    throw new Error("getRubricAssessmentPath requires workspaceRoot");
  }
  return path.join(workspaceRoot, RUBRIC_ASSESSMENT_FILE);
}

export async function recordRubricAssessment({
  workspaceRoot,
  record,
  telemetry = null,
} = {}) {
  if (!workspaceRoot) {
    throw new Error("recordRubricAssessment requires workspaceRoot");
  }
  const filePath = getRubricAssessmentPath(workspaceRoot);
  const saved = await appendAssessment(filePath, record);
  if (telemetry && typeof telemetry.captureEvent === "function") {
    try {
      telemetry.captureEvent(TELEMETRY_EVENT_RECORDED, {
        day: saved.day,
        axisCount: Object.keys(saved.axes).length,
      });
    } catch {
      // Telemetry failures must never block persistence.
    }
  }
  return { filePath, record: saved };
}

// Higher-level convenience: accept a flat `{ axis: score }` object plus optional
// per-axis `evidence_refs` and `no_evidence_reason`, hydrate via the canonical
// anchor table, and persist. This is the surface MCP tools and CLIs should call
// rather than re-hydrating each caller-side.
export async function recordFlatRubricAssessment({
  workspaceRoot,
  sessionId,
  day,
  axes,
  evidence = {},
  noEvidenceReasons = {},
  notes,
  recordedAt,
  telemetry = null,
} = {}) {
  if (!axes || typeof axes !== "object") {
    throw new Error("recordFlatRubricAssessment requires `axes` { axis: score, ... }");
  }
  const hydratedAxes = {};
  const missing = [];
  for (const axis of RUBRIC_AXES) {
    const score = axes[axis];
    if (typeof score !== "number") {
      missing.push(axis);
      continue;
    }
    const level = nearestAnchorLevel(score);
    const text = getAnchorText(axis, level);
    const reason = noEvidenceReasons?.[axis];
    hydratedAxes[axis] = {
      score,
      anchor_level: level,
      anchor_text: text || `(no anchor for ${axis} level ${level})`,
      evidence_refs: Array.isArray(evidence[axis]) ? evidence[axis] : [],
      ...(typeof reason === "string" && reason.length > 0
        ? { no_evidence_reason: reason }
        : {}),
    };
  }
  if (missing.length > 0) {
    throw new Error(
      `recordFlatRubricAssessment missing scores for axes: ${missing.join(", ")}`,
    );
  }
  const record = {
    sessionId,
    recordedAt: recordedAt || new Date().toISOString(),
    day,
    axes: hydratedAxes,
    ...(notes ? { notes } : {}),
  };
  return recordRubricAssessment({ workspaceRoot, record, telemetry });
}

function pickLatestByDay(records, day) {
  return (
    records
      .filter((record) => record.day === day)
      .sort((a, b) => (Date.parse(b.recordedAt) || 0) - (Date.parse(a.recordedAt) || 0))[0] || null
  );
}

export async function getRubricStatus(workspaceRoot) {
  const filePath = getRubricAssessmentPath(workspaceRoot);
  const records = await loadAssessmentsFromFile(filePath);
  const dayZero = pickLatestByDay(records, 0);
  const dayThirty = pickLatestByDay(records, 30);
  const delta = dayZero && dayThirty ? computeWithinPersonDelta(dayZero, dayThirty) : null;
  return {
    dayZero,
    dayThirty,
    delta,
    recordCount: records.length,
  };
}

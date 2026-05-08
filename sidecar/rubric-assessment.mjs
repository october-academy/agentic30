import fs from "node:fs/promises";
import { z } from "zod";

import { RUBRIC_AXES } from "./specialists/schema.mjs";
import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";

export const RUBRIC_ASSESSMENT_SCHEMA_VERSION = 1;

const EvidenceRefSchema = z.object({
  type: z.enum(["session_message", "doc_path", "external_link"]),
  ref: z.string().min(1),
  quote_excerpt: z.string().max(2000).optional(),
});

const AxisScoreSchema = z
  .object({
    score: z.number().int().min(1).max(5),
    anchor_level: z.union([z.literal(1), z.literal(3), z.literal(5)]),
    anchor_text: z.string().min(1),
    evidence_refs: z.array(EvidenceRefSchema).default([]),
    // `no_evidence_reason` lets a user honestly self-report a low score (≤ 2)
    // without producing fake evidence. It is also accepted as an alternative
    // to evidence_refs at score ≥ 3 — Codex MEDIUM review: avoids forcing the
    // user to fabricate evidence just to satisfy the validator.
    no_evidence_reason: z.string().min(1).max(500).optional(),
  })
  .superRefine((value, ctx) => {
    const hasEvidence = Array.isArray(value.evidence_refs) && value.evidence_refs.length > 0;
    const hasReason = typeof value.no_evidence_reason === "string" && value.no_evidence_reason.length > 0;
    if (value.score >= 3 && !hasEvidence && !hasReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence_refs"],
        message: "score >= 3 requires at least one evidence_refs entry or a no_evidence_reason",
      });
    }
  });

const axesShape = Object.fromEntries(RUBRIC_AXES.map((axis) => [axis, AxisScoreSchema]));

export const RubricAssessmentSchema = z
  .object({
    sessionId: z.string().min(1),
    userId: z.string().optional(),
    recordedAt: z.string().datetime({ offset: true }),
    day: z.union([z.literal(0), z.literal(30)]),
    axes: z.object(axesShape),
    notes: z.string().max(4000).optional(),
  })
  .superRefine((value, ctx) => {
    // Day 30 is the closing assessment: every axis must justify itself with
    // either evidence_refs or a `no_evidence_reason`. Day 0 is a baseline and
    // is intentionally allowed loose so users can start without performing.
    if (value.day !== 30) return;
    for (const axis of RUBRIC_AXES) {
      const entry = value.axes?.[axis];
      if (!entry) continue;
      const hasEvidence = Array.isArray(entry.evidence_refs) && entry.evidence_refs.length > 0;
      const hasReason = typeof entry.no_evidence_reason === "string" && entry.no_evidence_reason.length > 0;
      if (!hasEvidence && !hasReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["axes", axis, "evidence_refs"],
          message: `Day 30 requires evidence_refs or no_evidence_reason for axis "${axis}"`,
        });
      }
    }
  });

export const RubricAssessmentPayloadSchema = z.object({
  schemaVersion: z.literal(RUBRIC_ASSESSMENT_SCHEMA_VERSION),
  savedAt: z.string().datetime({ offset: true }),
  records: z.array(RubricAssessmentSchema),
});

export async function loadAssessmentsFromFile(
  filePath,
  { onRecoverableError = null, now = () => new Date() } = {},
) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  let records;
  try {
    const parsed = JSON.parse(raw);
    records = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.records)
        ? parsed.records
        : [];
  } catch (error) {
    const quarantinePath = await quarantineCorrupt(filePath, raw, now);
    onRecoverableError?.({
      type: "rubric_assessment_store_corrupt",
      filePath,
      quarantinePath,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
  // Per-record validation: keep what passes, quarantine + diagnose what fails.
  // The legacy code silently dropped schema-invalid records, which became a
  // data-loss risk after Round 1 added Day 30 record-level rules (Codex MEDIUM
  // review). The valid records remain in the canonical file; only invalid ones
  // are siphoned off for inspection.
  const valid = [];
  const invalid = [];
  for (const rec of records) {
    const result = RubricAssessmentSchema.safeParse(rec);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({ result, original: rec });
    }
  }
  if (invalid.length > 0) {
    const quarantinePath = await quarantineInvalidRecords(filePath, invalid, now);
    onRecoverableError?.({
      type: "rubric_assessment_record_invalid",
      filePath,
      quarantinePath,
      invalidCount: invalid.length,
      issues: invalid.map((entry) => ({
        sessionId: entry.original?.sessionId ?? null,
        day: entry.original?.day ?? null,
        messages: entry.result.error.issues.map(
          (iss) => `${iss.path.join(".") || "<root>"}: ${iss.message}`,
        ),
      })),
    });
  }
  return valid;
}

export async function persistAssessmentsToFile(
  filePath,
  records,
  { now = () => new Date() } = {},
) {
  const payload = {
    schemaVersion: RUBRIC_ASSESSMENT_SCHEMA_VERSION,
    savedAt: now().toISOString(),
    records,
  };
  await atomicWriteJson(filePath, payload);
}

export function computeWithinPersonDelta(day0, day30) {
  if (!day0 || !day30) return null;
  return RUBRIC_AXES.map((axis) => {
    const before = day0.axes?.[axis]?.score ?? null;
    const after = day30.axes?.[axis]?.score ?? null;
    return {
      axis,
      day0_score: before,
      day30_score: after,
      delta: before == null || after == null ? null : after - before,
    };
  });
}

export async function appendAssessment(filePath, record, opts = {}) {
  // Validate before acquiring the lock so we never hold a lock for invalid input.
  const result = RubricAssessmentSchema.safeParse(record);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid rubric assessment record: ${issues}`);
  }
  return withFileLock(filePath, async () => {
    const existing = await loadAssessmentsFromFile(filePath, opts);
    await persistAssessmentsToFile(filePath, [...existing, result.data], opts);
    return result.data;
  });
}

async function quarantineCorrupt(filePath, raw, now) {
  const timestamp = now().toISOString().replace(/[:.]/g, "-");
  const quarantinePath = `${filePath}.corrupt-${timestamp}`;
  try {
    await fs.rename(filePath, quarantinePath);
  } catch {
    await fs.writeFile(quarantinePath, raw, { mode: 0o600 });
    await fs.unlink(filePath).catch(() => {});
  }
  await fs.chmod(quarantinePath, 0o600).catch(() => {});
  return quarantinePath;
}

// Mirrors `quarantineCorrupt` for the partial-validation case: the canonical
// file stays in place (so valid records keep working), and only the rejected
// originals are written out alongside for later inspection.
async function quarantineInvalidRecords(filePath, invalid, now) {
  const timestamp = now().toISOString().replace(/[:.]/g, "-");
  const quarantinePath = `${filePath}.invalid-${timestamp}.json`;
  const payload = {
    schemaVersion: RUBRIC_ASSESSMENT_SCHEMA_VERSION,
    quarantinedAt: now().toISOString(),
    sourceFile: filePath,
    records: invalid.map((entry) => ({
      original: entry.original,
      issues: entry.result.error.issues.map((iss) => ({
        path: iss.path,
        message: iss.message,
      })),
    })),
  };
  await fs.writeFile(quarantinePath, JSON.stringify(payload, null, 2), {
    mode: 0o600,
  });
  await fs.chmod(quarantinePath, 0o600).catch(() => {});
  return quarantinePath;
}

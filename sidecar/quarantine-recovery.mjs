import path from "node:path";
import fs from "node:fs/promises";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import {
  RubricAssessmentSchema,
  loadAssessmentsFromFile,
  persistAssessmentsToFile,
} from "./rubric-assessment.mjs";
import { swallow } from "./error-telemetry.mjs";

// Quarantine recovery surface for Day 30 schema-invalid records (Round 2 leaves
// them in `<workspace>/.agentic30/<source>.invalid-<timestamp>.json`). Round 4
// gives Mac users a list/restore flow rather than CLI-only recovery.

const INVALID_FILE_PATTERN = /\.invalid-[0-9TZ:.\-]+\.json$/;
const AGENTIC_DIR = ".agentic30";

// R5-2: quarantine archival. Files older than this are considered abandoned
// and pruned during the next list call. Default: 90 days. Caller may override
// for tests via the `maxAgeDays` argument on `pruneExpiredQuarantineFiles`.
const DEFAULT_QUARANTINE_MAX_AGE_DAYS = 90;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Codex MEDIUM #4: every path must stay inside the workspace. Reuses the same
// shape as `assertInside()` in mcp-server.mjs — we duplicate the helper here
// so this domain module has no dependency on the MCP wiring.
export function assertInsideWorkspace(workspaceRoot, candidate) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedTarget = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`quarantine path must stay inside the workspace (${candidate})`);
  }
}

export async function resolveInsideWorkspaceRealpath(workspaceRoot, candidate) {
  assertInsideWorkspace(workspaceRoot, candidate);
  const [rootRealpath, targetRealpath] = await Promise.all([
    fs.realpath(workspaceRoot),
    fs.realpath(candidate),
  ]);
  const rel = path.relative(rootRealpath, targetRealpath);
  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`quarantine path must stay inside the workspace (${candidate})`);
  }
  return targetRealpath;
}

export async function listQuarantinedFiles({
  workspaceRoot,
  agenticDir = AGENTIC_DIR,
  maxAgeDays = DEFAULT_QUARANTINE_MAX_AGE_DAYS,
  now = () => Date.now(),
} = {}) {
  if (!workspaceRoot) throw new Error("listQuarantinedFiles requires workspaceRoot");
  // Best-effort prune before list — keeps quarantine directory bounded
  // without forcing a separate cron. Failures are swallowed; the list
  // itself must still succeed.
  await swallow(
    "quarantine_prune_expired",
    pruneExpiredQuarantineFiles({
      workspaceRoot,
      agenticDir,
      maxAgeDays,
      now,
    }),
  );
  const dir = path.join(workspaceRoot, agenticDir);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!INVALID_FILE_PATTERN.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    assertInsideWorkspace(workspaceRoot, full);
    const stat = await fs.stat(full);
    files.push({
      path: full,
      name: entry.name,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

// Removes `.invalid-*.json` files older than `maxAgeDays`. Returns the list
// of removed paths so callers (or tests) can reason about what disappeared.
export async function pruneExpiredQuarantineFiles({
  workspaceRoot,
  agenticDir = AGENTIC_DIR,
  maxAgeDays = DEFAULT_QUARANTINE_MAX_AGE_DAYS,
  now = () => Date.now(),
} = {}) {
  if (!workspaceRoot) throw new Error("pruneExpiredQuarantineFiles requires workspaceRoot");
  if (maxAgeDays === Infinity || maxAgeDays <= 0) return [];
  const dir = path.join(workspaceRoot, agenticDir);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const cutoff = now() - maxAgeDays * ONE_DAY_MS;
  const removed = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!INVALID_FILE_PATTERN.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    assertInsideWorkspace(workspaceRoot, full);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (stat.mtimeMs < cutoff) {
      try {
        await fs.unlink(full);
        removed.push(full);
      } catch {
        // ignore — best-effort; file may already be gone.
      }
    }
  }
  return removed;
}

export async function readQuarantineDump({ workspaceRoot, quarantinePath } = {}) {
  if (!workspaceRoot || !quarantinePath) {
    throw new Error("readQuarantineDump requires workspaceRoot and quarantinePath");
  }
  const safeQuarantinePath = await resolveInsideWorkspaceRealpath(workspaceRoot, quarantinePath);
  const raw = await fs.readFile(safeQuarantinePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.records)) {
    throw new Error("quarantine dump missing records array");
  }
  const stat = await fs.stat(safeQuarantinePath);
  return {
    quarantinePath: safeQuarantinePath,
    sourceFile: typeof parsed.sourceFile === "string" ? parsed.sourceFile : null,
    quarantinedAt: typeof parsed.quarantinedAt === "string" ? parsed.quarantinedAt : null,
    mtimeMs: stat.mtimeMs,
    records: parsed.records.map((entry, index) => ({
      index,
      original: entry?.original ?? null,
      issues: Array.isArray(entry?.issues) ? entry.issues : [],
      proposal: buildAutoSuggestProposal(entry),
    })),
  };
}

export async function restoreQuarantinedRecord({
  workspaceRoot,
  quarantinePath,
  recordIndex,
  fixedRecord,
  expectedMtimeMs,
} = {}) {
  if (!workspaceRoot || !quarantinePath) {
    throw new Error("restoreQuarantinedRecord requires workspaceRoot and quarantinePath");
  }
  let safeQuarantinePath;
  try {
    safeQuarantinePath = await resolveInsideWorkspaceRealpath(workspaceRoot, quarantinePath);
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error("quarantine file no longer exists; refresh and retry");
    }
    throw err;
  }
  // Pre-flight schema check before acquiring locks.
  const valid = RubricAssessmentSchema.safeParse(fixedRecord);
  if (!valid.success) {
    const issues = valid.error.issues
      .map((iss) => `${iss.path.join(".") || "<root>"}: ${iss.message}`)
      .join("; ");
    throw new Error(`fixedRecord still invalid: ${issues}`);
  }
  return withFileLock(safeQuarantinePath, async () => {
    let stat;
    try {
      stat = await fs.stat(safeQuarantinePath);
    } catch (err) {
      if (err.code === "ENOENT") {
        throw new Error("quarantine file no longer exists; refresh and retry");
      }
      throw err;
    }
    // Codex MEDIUM #1: optimistic concurrency.
    if (typeof expectedMtimeMs === "number" && stat.mtimeMs !== expectedMtimeMs) {
      throw new Error("quarantine file changed since list; refresh and retry");
    }
    const dump = JSON.parse(await fs.readFile(safeQuarantinePath, "utf8"));
    const records = Array.isArray(dump.records) ? dump.records : [];
    if (!Number.isInteger(recordIndex) || recordIndex < 0 || recordIndex >= records.length) {
      throw new Error("recordIndex out of range");
    }
    const sourceFile = dump.sourceFile;
    if (typeof sourceFile !== "string" || sourceFile.length === 0) {
      throw new Error("quarantine dump missing sourceFile");
    }
    assertInsideWorkspace(workspaceRoot, sourceFile);
    // Round 6 / CCG-Codex: 순서 반전. canonical 성공이 보장된 후에 quarantine
    // entry를 제거. canonical write가 실패하면 quarantine은 그대로 유지되어
    // 사용자가 다시 시도할 수 있다(데이터 소실 차단). 또한 같은 entry가 두 번
    // restore되더라도 sessionId+recordedAt dedupe로 canonical 중복 방지.
    let canonicalDuplicateAvoided = false;
    await withFileLock(sourceFile, async () => {
      const existing = await loadAssessmentsFromFile(sourceFile);
      const dedupeKey = `${valid.data.sessionId}|${valid.data.recordedAt}`;
      const alreadyExists = existing.some(
        (r) => `${r.sessionId}|${r.recordedAt}` === dedupeKey,
      );
      if (alreadyExists) {
        canonicalDuplicateAvoided = true;
        return;
      }
      await persistAssessmentsToFile(sourceFile, [...existing, valid.data]);
    });
    // Canonical succeeded (or duplicate detected — entry is effectively already
    // in the store). Now consume the quarantine entry.
    const remaining = records.filter((_, i) => i !== recordIndex);
    if (remaining.length === 0) {
      await fs.unlink(safeQuarantinePath);
    } else {
      await atomicWriteJson(safeQuarantinePath, { ...dump, records: remaining });
    }
    return {
      restoredSessionId: valid.data.sessionId,
      remainingInvalidCount: remaining.length,
      quarantinePath: safeQuarantinePath,
      duplicateAvoided: canonicalDuplicateAvoided,
    };
  });
}

// Round 6 / CCG-UX: build a fixedRecord from `entry.original` + a single
// honest-mode reason from the user. Preserves the original axis scores and
// anchors so a Day-30 record's identity (its measured progress) is not
// overwritten by a fresh score=1 stub. The Mac client now sends only the
// reason; sidecar owns the schema-shape decisions.
const RUBRIC_AXES_FALLBACK = [
  "definition",
  "command",
  "clout",
  "responsibility",
  "adaptability",
];

export function proposeFixForEntry(entry, honestModeReason) {
  if (typeof honestModeReason !== "string" || honestModeReason.trim().length === 0) {
    throw new Error("proposeFixForEntry requires a non-empty honestModeReason");
  }
  const reason = honestModeReason.slice(0, 500);
  const original = entry?.original && typeof entry.original === "object" ? entry.original : null;
  const issueAxes = collectIssueAxes(entry?.issues);
  // Compose the axes object: prefer original shape, fall back to a baseline
  // skeleton when the original is missing or unusable.
  const axes = {};
  for (const axis of RUBRIC_AXES_FALLBACK) {
    const baseEntry = original?.axes?.[axis];
    if (baseEntry && typeof baseEntry === "object" && typeof baseEntry.score === "number") {
      axes[axis] = {
        score: baseEntry.score,
        anchor_level:
          baseEntry.anchor_level === 1
          || baseEntry.anchor_level === 3
          || baseEntry.anchor_level === 5
            ? baseEntry.anchor_level
            : 1,
        anchor_text: typeof baseEntry.anchor_text === "string" && baseEntry.anchor_text.length > 0
          ? baseEntry.anchor_text
          : "Day 30 baseline",
        evidence_refs: Array.isArray(baseEntry.evidence_refs) ? baseEntry.evidence_refs : [],
      };
      // Carry over the existing reason if present and not flagged by issues.
      if (typeof baseEntry.no_evidence_reason === "string" && baseEntry.no_evidence_reason.length > 0) {
        axes[axis].no_evidence_reason = baseEntry.no_evidence_reason;
      }
    } else {
      // No original shape for this axis — use a Day-30 baseline skeleton.
      axes[axis] = {
        score: 1,
        anchor_level: 1,
        anchor_text: "Day 30 baseline",
        evidence_refs: [],
      };
    }
    // Apply the honest-mode reason to axes the issues complained about, AND
    // to axes that still lack both evidence and a reason (defensive — covers
    // legacy records where issues were not enumerated per axis).
    const needsReason =
      issueAxes.has(axis)
      || (axes[axis].evidence_refs.length === 0 && !axes[axis].no_evidence_reason);
    if (needsReason) {
      axes[axis].no_evidence_reason = reason;
    }
  }
  const day = original?.day === 0 || original?.day === 30 ? original.day : 30;
  const sessionId = typeof original?.sessionId === "string" && original.sessionId.length > 0
    ? original.sessionId
    : `quarantine-restore-${Date.now()}`;
  const recordedAt = typeof original?.recordedAt === "string" && original.recordedAt.length > 0
    ? original.recordedAt
    : new Date().toISOString();
  return {
    sessionId,
    recordedAt,
    day,
    axes,
    ...(typeof original?.notes === "string" && original.notes.length > 0
      ? { notes: original.notes }
      : {}),
  };
}

function collectIssueAxes(issues) {
  const axes = new Set();
  if (!Array.isArray(issues)) return axes;
  for (const issue of issues) {
    const segs = Array.isArray(issue?.path) ? issue.path : [];
    if (segs[0] === "axes" && typeof segs[1] === "string") {
      axes.add(segs[1]);
    }
  }
  return axes;
}

// Auto-suggest hint for the most common Day 30 schema misses. Stays in the
// sidecar domain so the Mac client doesn't re-implement schema-rule heuristics
// (Phase 3 of round4-quarantine-ui plan).
export function buildAutoSuggestProposal(entry) {
  if (!entry || !Array.isArray(entry.issues)) return null;
  for (const issue of entry.issues) {
    const pathSegs = Array.isArray(issue?.path) ? issue.path : [];
    const message = typeof issue?.message === "string" ? issue.message : "";
    if (pathSegs[0] === "axes" && pathSegs[2] === "evidence_refs") {
      const axis = pathSegs[1];
      if (/Day 30 requires evidence_refs or no_evidence_reason/.test(message)) {
        return {
          kind: "missing_no_evidence_reason",
          axis,
          suggestion: `Day 30 마감인데 ${axis} 축에 근거가 없습니다. 한 줄로 이유를 적으면 정직 모드로 통과합니다.`,
          fixHint: { type: "fill_no_evidence_reason", axis },
        };
      }
      if (/score >= 3 requires/.test(message)) {
        return {
          kind: "missing_evidence_refs",
          axis,
          suggestion: `${axis} 축 점수가 3 이상인데 근거가 없습니다. 1개라도 추가하거나, 어렵다면 정직 모드 한 줄로 대체하세요.`,
          fixHint: { type: "fill_evidence_or_reason", axis },
        };
      }
    }
  }
  return null;
}

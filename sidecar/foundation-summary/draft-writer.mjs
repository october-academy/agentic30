/**
 * Foundation-summary sub-workflow — draft.v2 writer (AC 13 Sub-AC 5).
 *
 * Day 7's foundation-summary lane fans out into THREE artifact contracts:
 *
 *   - SPEC.md            — final SPEC v3 the agent locked in (overwrites the
 *                          v0/v1/v2 evolution under workspace/.agentic30/foundation/).
 *   - go-no-go.md        — explicit Continue / Pivot / Restart decision with
 *                          numeric supports (monetization yes count, artifact
 *                          completeness, spec versions present).
 *   - foundation-summary.md
 *                        — Day-by-Day rollup with evidence-ref counts and
 *                          missing-input ledger.
 *
 * All three are rendered as "draft.v2" — i.e. the SDK + review-loop refined
 * artifacts that supersede the deterministic draft.v1 produced by
 * `evidence-collector.mjs::buildFoundationSummaryDraftV1()`.
 *
 * The writer is intentionally narrow:
 *   • It accepts pre-parsed `sections` (Sub-AC 5 integration handles parsing
 *     the assistant text into named blocks) so the same writer can serve a
 *     test fixture, a live SDK call, or a manual override.
 *   • It writes only the sections that are non-empty — partial draft.v2
 *     writes are valid (e.g. agent emits SPEC v3 + summary but skips
 *     go-no-go because the user is still deliberating).
 *   • It always emits a `draft.v2.json` audit sidecar that captures the
 *     lineage from draft.v1 → draft.v2 (line counts, verdict, review-loop
 *     status) so KR4.2 cross-checks can pin drift across iterations.
 *   • It never overwrites silently when `sections.<x>` is the empty string —
 *     callers must explicitly pass content for each artifact they want
 *     persisted. That keeps a half-finished review loop from blanking a
 *     previously-good SPEC v3.
 *
 * Pure with respect to fs / clock — both are injectable so the module is
 * unit-testable without filesystem fixtures.
 */

import nodeFs from "node:fs/promises";
import path from "node:path";

/**
 * Schema version of the draft.v2 audit JSON. Bump only when the audit shape
 * changes. The artifact bodies (SPEC.md / go-no-go.md / foundation-summary.md)
 * are markdown — they have no schema version of their own.
 */
export const DRAFT_V2_SCHEMA_VERSION = 2;

/**
 * Filenames the writer manages under `workspace/.agentic30/foundation/`.
 * Exposed so tests + integration code can reference the same constants.
 */
export const FOUNDATION_DRAFT_V2_FILES = Object.freeze({
  spec_md: "SPEC.md",
  go_no_go: "go-no-go.md",
  foundation_summary: "foundation-summary.md",
  audit: "draft.v2.json",
});

const ARTIFACT_KEYS = Object.freeze(["spec_md", "go_no_go", "foundation_summary"]);

/**
 * Write the draft.v2 artifacts to the workspace.
 *
 * @param {object}   args
 * @param {string}   args.workspaceRoot   - Absolute workspace root.
 * @param {object}   args.sections        - Parsed sections — at minimum:
 *                                          `{ spec_md_v3?, go_no_go?,
 *                                             foundation_summary? }`.
 *                                          Empty / missing entries are skipped.
 * @param {object}   [args.draftV1]       - Optional draft.v1 bundle for the
 *                                          audit sidecar lineage. Shape from
 *                                          `buildFoundationSummaryDraftV1`.
 * @param {object}   [args.verdict]       - Optional rule-check verdict (Sub-AC 3)
 *                                          captured in the audit JSON.
 * @param {object}   [args.reviewLoop]    - Optional review-loop result (Sub-AC 4)
 *                                          captured in the audit JSON.
 * @param {string}   [args.assistantText] - Optional raw assistant text — only
 *                                          its length is captured (audit only).
 * @param {object}   [args.fs]            - `node:fs/promises`-shaped override.
 * @param {() => Date} [args.now]         - Clock injection.
 * @returns {Promise<{
 *   schema_version: number,
 *   workspace_root: string,
 *   foundation_dir: string,
 *   paths: { spec_md?: string, go_no_go?: string,
 *            foundation_summary?: string, audit: string },
 *   sections_present: string[],
 *   sections_skipped: string[],
 *   audit: object,
 * }>}
 */
export async function writeFoundationSummaryDraftV2({
  workspaceRoot = "",
  sections = {},
  draftV1 = null,
  verdict = null,
  reviewLoop = null,
  assistantText = "",
  fs = nodeFs,
  now = () => new Date(),
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("writeFoundationSummaryDraftV2 requires a non-empty workspaceRoot.");
  }
  const root = path.resolve(workspaceRoot);
  const foundationDir = path.join(root, ".agentic30", "foundation");
  await fs.mkdir(foundationDir, { recursive: true });

  const writtenAt = isoNow(now);

  // Map the Sub-AC 5 section keys (spec_md_v3 / go_no_go / foundation_summary)
  // onto the artifact-name keys the audit JSON + filesystem use.
  const sectionMap = {
    spec_md: typeof sections?.spec_md_v3 === "string" ? sections.spec_md_v3.trim() : "",
    go_no_go: typeof sections?.go_no_go === "string" ? sections.go_no_go.trim() : "",
    foundation_summary:
      typeof sections?.foundation_summary === "string"
        ? sections.foundation_summary.trim()
        : "",
  };

  const paths = {};
  const sectionsPresent = [];
  const sectionsSkipped = [];
  const writes = [];

  for (const key of ARTIFACT_KEYS) {
    const body = sectionMap[key];
    if (!body) {
      sectionsSkipped.push(key);
      continue;
    }
    const filename = FOUNDATION_DRAFT_V2_FILES[key];
    const target = path.join(foundationDir, filename);
    const rendered = renderArtifactBody({ key, body, writtenAt });
    writes.push(safeWrite(fs, target, rendered));
    paths[key] = target;
    sectionsPresent.push(key);
  }

  const auditPath = path.join(foundationDir, FOUNDATION_DRAFT_V2_FILES.audit);
  const audit = buildAudit({
    paths,
    sectionsPresent,
    sectionsSkipped,
    sectionMap,
    draftV1,
    verdict,
    reviewLoop,
    assistantText,
    writtenAt,
  });
  writes.push(safeWrite(fs, auditPath, JSON.stringify(audit, null, 2)));

  await Promise.all(writes);

  return {
    schema_version: DRAFT_V2_SCHEMA_VERSION,
    workspace_root: root,
    foundation_dir: foundationDir,
    paths: { ...paths, audit: auditPath },
    sections_present: sectionsPresent,
    sections_skipped: sectionsSkipped,
    audit,
  };
}

/**
 * Parse the foundation-summary agent's assistant text into the three named
 * draft.v2 sections. The agent is prompted (foundation-summary/prompt.mjs)
 * to label its output so this parser can fish each block out.
 *
 * Recognized heading patterns (markdown 1-4 levels deep, case-insensitive):
 *   - "SPEC v3", "SPEC.md v3", "SPEC v3 (draft.v2)" → spec_md_v3
 *   - "go-no-go", "go-no-go.md", "Go No Go"        → go_no_go
 *   - "foundation-summary", "foundation summary",
 *     "foundation-summary.md"                       → foundation_summary
 *
 * Returns an object with the trimmed body of each section (between the
 * matching heading and the next labeled heading / EOF). Empty when no
 * matching heading is found — callers should fall back to draft.v1.
 *
 * Pure / synchronous so it composes inside tests and the integration glue.
 */
export function parseDraftV2Sections(assistantText) {
  const out = { spec_md_v3: "", go_no_go: "", foundation_summary: "" };
  if (typeof assistantText !== "string" || !assistantText.trim()) return out;

  const lines = assistantText.split(/\r?\n/);
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(#{1,4})\s+(.+?)\s*$/.exec(lines[i]);
    if (!match) continue;
    const label = classifyHeading(match[2]);
    if (!label) continue;
    headings.push({ index: i, label });
  }
  if (headings.length === 0) return out;

  for (let h = 0; h < headings.length; h++) {
    const cur = headings[h];
    const next = headings[h + 1];
    const startLine = cur.index + 1;
    const endLine = next ? next.index : lines.length;
    const body = lines.slice(startLine, endLine).join("\n").trim();
    // Last heading wins if the agent emits the same label twice — gives the
    // model a way to retry a section in-place without us mistakenly stitching
    // the older copy in.
    if (body) out[cur.label] = body;
  }
  return out;
}

// ──────────────────────── internal helpers ────────────────────────

function classifyHeading(text) {
  const cleaned = String(text || "")
    .toLowerCase()
    .replace(/\(draft\.v\d+\)/g, "")
    .replace(/[`*_~]/g, "")
    .trim();
  if (/spec(\.md)?\s*v3/.test(cleaned)) return "spec_md_v3";
  if (/go[\s-]*no[\s-]*go(\.md)?/.test(cleaned)) return "go_no_go";
  if (/foundation[\s-]*summary(\.md)?/.test(cleaned)) return "foundation_summary";
  return null;
}

function renderArtifactBody({ key, body, writtenAt }) {
  // Each artifact gets a stable preamble so downstream consumers (tests, KR4.2
  // cross-check, evidence collector) can detect "this file is draft.v2".
  // The preamble is intentionally markdown so the file remains a valid .md.
  const heading = artifactHeading(key);
  return [
    `# ${heading} (draft.v2)`,
    "",
    `> Foundation Day 7 — generated_at: ${writtenAt}`,
    "> draft.v2 by foundation-summary sub-workflow.",
    "> Edit + commit if accepted. Re-running Day 7 will overwrite this file.",
    "",
    body.trim(),
    "",
  ].join("\n");
}

function artifactHeading(key) {
  switch (key) {
    case "spec_md":
      return "SPEC.md v3";
    case "go_no_go":
      return "go-no-go.md";
    case "foundation_summary":
      return "foundation-summary.md";
    default:
      return key;
  }
}

function buildAudit({
  paths,
  sectionsPresent,
  sectionsSkipped,
  sectionMap,
  draftV1,
  verdict,
  reviewLoop,
  assistantText,
  writtenAt,
}) {
  return {
    schema_version: DRAFT_V2_SCHEMA_VERSION,
    written_at: writtenAt,
    artifacts: { ...paths },
    sections_present: [...sectionsPresent],
    sections_skipped: [...sectionsSkipped],
    section_chars: {
      spec_md_v3: sectionMap.spec_md.length,
      go_no_go: sectionMap.go_no_go.length,
      foundation_summary: sectionMap.foundation_summary.length,
    },
    assistant_text_chars: typeof assistantText === "string" ? assistantText.length : 0,
    draft_v1: draftV1
      ? {
          schema_version: draftV1.schema_version ?? null,
          spec_md_v3_chars: stringLen(draftV1.spec_md_v3),
          go_no_go_md_chars: stringLen(draftV1.go_no_go_md),
          foundation_summary_md_chars: stringLen(draftV1.foundation_summary_md),
        }
      : null,
    verdict: verdict
      ? {
          pass: Boolean(verdict.pass),
          score: typeof verdict.score === "number" ? verdict.score : null,
          reasons: Array.isArray(verdict.reasons) ? [...verdict.reasons] : [],
          schema_version: verdict.schema_version ?? null,
        }
      : null,
    review_loop: reviewLoop
      ? {
          status: typeof reviewLoop.status === "string" ? reviewLoop.status : null,
          passed: Boolean(reviewLoop.passed),
          total_iterations:
            typeof reviewLoop.total_iterations === "number"
              ? reviewLoop.total_iterations
              : null,
          max_iterations:
            typeof reviewLoop.max_iterations === "number"
              ? reviewLoop.max_iterations
              : null,
          reason: typeof reviewLoop.reason === "string" ? reviewLoop.reason : "",
          finalized_at:
            typeof reviewLoop.finalized_at === "string" ? reviewLoop.finalized_at : null,
          schema_version: reviewLoop.schema_version ?? null,
        }
      : null,
  };
}

function stringLen(value) {
  return typeof value === "string" ? value.length : 0;
}

async function safeWrite(fs, target, body) {
  // mode 0o600 mirrors persistEvidenceRefsSidecar — keep workspace artifacts
  // user-only by default. The Mac sandbox already scopes them to the user's
  // home, but pinning the mode lets a creator copy the workspace into a
  // shared folder without leaking content by default.
  await fs.writeFile(target, body, { mode: 0o600 });
}

function isoNow(now) {
  try {
    const d = typeof now === "function" ? now() : now;
    if (d instanceof Date) return d.toISOString();
    if (typeof d === "string") return d;
  } catch {
    /* fall through */
  }
  return new Date().toISOString();
}

export const __test__ = Object.freeze({
  classifyHeading,
  renderArtifactBody,
  buildAudit,
});

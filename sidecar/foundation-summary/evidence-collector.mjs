/**
 * Foundation-summary sub-workflow — evidence collection (Sub-AC 2).
 *
 * Day 7 must walk the Day 0-6 workspace artifacts and produce a
 * deterministic `draft.v1` that frames the SPEC v3 / go-no-go.md /
 * foundation-summary.md candidates the agent then refines.
 *
 * The runtime agent (index.mjs) is constrained to Read / Glob / Grep
 * (read-only). This module performs the same scan up-front in plain
 * Node `fs` so:
 *
 *   - The agent prompt can include a precomputed evidence snapshot,
 *     biasing the model toward the actual workspace state instead of
 *     fabricating values when its tool budget runs out.
 *   - The KR4.2 cross-check can pin draft.v1 against the agent's
 *     final draft to detect drift.
 *   - The host can fall back to draft.v1 verbatim if the SDK call
 *     fails before the agent emits its own summary.
 *
 * Schema:
 *
 *   {
 *     schema_version: 1,
 *     workspace_root,
 *     foundation_dir,
 *     foundation_dir_present,
 *     collected_at,
 *     days: [{ day, core_question, sub_workflow, spec_version,
 *              artifacts_expected, artifacts_found:[{file,path,exists,
 *              size,mtime,excerpt}], missing:[file...], input_sources,
 *              evidence_refs_count }, ...],
 *     spec_versions_expected,
 *     spec_versions_present,
 *     spec_md: { path, present, size, mtime, headings:[...] },
 *     monetization_ask: { artifact, present, classification,
 *                          response_yes_count, payment_executed,
 *                          excerpt },
 *     evidence_sidecars: { dir, present, files:[{path, day,
 *                          session_id, message_id, sub_workflow,
 *                          overall_confidence}], total },
 *     artifacts_completeness, // 0..1 ratio of expected artifacts found
 *     monetization_signal,    // "yes" | "no" | "maybe" | "no_reply" | "missing"
 *     missing_inputs:[{day, file, reason}],
 *     go_no_go_recommendation, // "continue" | "restart" | "pivot"
 *     go_no_go_reason,
 *   }
 *
 * `buildFoundationSummaryDraftV1(evidence)` then turns that into the
 * candidate-text bundle the agent prompt embeds.
 */

import nodeFs from "node:fs/promises";
import path from "node:path";
import { FOUNDATION_DAYS } from "../foundation-chat.mjs";

const DRAFT_SCHEMA_VERSION = 1;
const ARTIFACT_EXCERPT_CHARS = 480;
const SIDECAR_LIST_CAP = 64;
const HEADING_CAP = 24;

/**
 * Collect Foundation Day 0-7 evidence from a workspace root. Returns the
 * deterministic schema documented at the top of the file. Never throws on
 * missing files — every gap is recorded under `missing` / `missing_inputs`
 * so the agent prompt can pressure the user honestly.
 *
 * @param {object} args
 * @param {string} args.workspaceRoot - Absolute workspace root (the user's
 *   project directory). Required; an empty string returns a "no workspace"
 *   shell so callers can short-circuit safely.
 * @param {object} [args.fs] - Optional `node:fs/promises`-shaped override
 *   for tests. Must expose `stat`, `readFile`, `readdir`.
 * @param {() => Date} [args.now] - Optional clock injection for tests.
 * @returns {Promise<object>} Evidence snapshot.
 */
export async function collectFoundationEvidence({
  workspaceRoot = "",
  fs = nodeFs,
  now = () => new Date(),
} = {}) {
  const collectedAt = now().toISOString();
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    return emptyEvidence({ workspaceRoot: "", collectedAt });
  }

  const root = path.resolve(workspaceRoot);
  const foundationDir = path.join(root, ".agentic30", "foundation");
  const evidenceDir = path.join(foundationDir, "evidence");

  const foundationDirPresent = await pathExists(fs, foundationDir);
  const days = [];
  const missingInputs = [];
  let foundCount = 0;
  let expectedCount = 0;

  for (let day = 0; day <= 7; day++) {
    const descriptor = FOUNDATION_DAYS[day];
    if (!descriptor) continue;

    const expected = Array.isArray(descriptor.artifacts) ? [...descriptor.artifacts] : [];
    expectedCount += expected.length;

    const found = [];
    const missing = [];
    for (const file of expected) {
      const abs = path.join(foundationDir, file);
      const stat = await safeStat(fs, abs);
      if (!stat) {
        missing.push(file);
        missingInputs.push({
          day,
          file,
          reason: "not_present_in_foundation_dir",
        });
        continue;
      }
      foundCount += 1;
      const excerpt = await safeReadExcerpt(fs, abs, ARTIFACT_EXCERPT_CHARS);
      found.push({
        file,
        path: abs,
        exists: true,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        excerpt,
      });
    }

    days.push({
      day,
      core_question: descriptor.core_question,
      sub_workflow: descriptor.sub_workflow ?? null,
      spec_version: descriptor.spec_version ?? null,
      input_sources: [...(descriptor.input_sources || [])],
      artifacts_expected: expected,
      artifacts_found: found,
      missing,
      evidence_refs_count: 0, // back-filled after sidecar walk
    });
  }

  const sidecars = await collectEvidenceSidecars(fs, evidenceDir);
  // Back-fill evidence_refs_count per day from sidecar.day field.
  for (const sidecar of sidecars.files) {
    const dayBucket = days.find((d) => d.day === sidecar.day);
    if (dayBucket) dayBucket.evidence_refs_count += 1;
  }

  const specMdInfo = await readSpecMdInfo(fs, foundationDir);
  const specVersionsExpected = ["v0", "v1", "v2", "v3"];
  const specVersionsPresent = computeSpecVersionsPresent({
    days,
    specMd: specMdInfo,
  });

  const monetization = await collectMonetizationAsk(fs, foundationDir);
  const completeness = expectedCount === 0 ? 0 : foundCount / expectedCount;
  const goNoGo = recommendGoNoGo({ monetization, completeness, days });

  return {
    schema_version: DRAFT_SCHEMA_VERSION,
    workspace_root: root,
    foundation_dir: foundationDir,
    foundation_dir_present: foundationDirPresent,
    collected_at: collectedAt,
    days,
    spec_versions_expected: specVersionsExpected,
    spec_versions_present: specVersionsPresent,
    spec_md: specMdInfo,
    monetization_ask: monetization,
    evidence_sidecars: sidecars,
    artifacts_completeness: round2(completeness),
    monetization_signal: monetization.classification || "missing",
    missing_inputs: missingInputs,
    go_no_go_recommendation: goNoGo.recommendation,
    go_no_go_reason: goNoGo.reason,
  };
}

/**
 * Build the draft.v1 candidate-text bundle from collected evidence. Returns
 * three labelled markdown bodies plus a flat `text` rollup the agent prompt
 * can embed directly. Stays terse on purpose — the agent's job is to
 * sharpen this, not start from blank.
 *
 * @param {object} evidence - Output of `collectFoundationEvidence()`.
 * @returns {{
 *   schema_version: number,
 *   spec_md_v3: string,
 *   go_no_go_md: string,
 *   foundation_summary_md: string,
 *   text: string,
 * }}
 */
export function buildFoundationSummaryDraftV1(evidence) {
  if (!evidence || typeof evidence !== "object") {
    return {
      schema_version: DRAFT_SCHEMA_VERSION,
      spec_md_v3: "",
      go_no_go_md: "",
      foundation_summary_md: "",
      text: "",
    };
  }

  const specV3 = renderSpecMdV3Draft(evidence);
  const goNoGo = renderGoNoGoDraft(evidence);
  const summary = renderFoundationSummaryDraft(evidence);

  const text = [
    "## Pre-collected Evidence (draft.v1)",
    `- workspace: ${evidence.workspace_root || "(unknown)"}`,
    `- foundation dir: ${evidence.foundation_dir_present ? "present" : "MISSING"}`,
    `- artifacts completeness: ${(evidence.artifacts_completeness * 100).toFixed(0)}%`,
    `- spec versions present: ${evidence.spec_versions_present.join(", ") || "(none)"}`,
    `- monetization signal: ${evidence.monetization_signal}`,
    `- evidence sidecars: ${evidence.evidence_sidecars.total}`,
    `- recommended go/no-go: ${evidence.go_no_go_recommendation} — ${evidence.go_no_go_reason}`,
    "",
    "### draft.v1 — SPEC.md v3 candidate",
    specV3,
    "",
    "### draft.v1 — go-no-go.md candidate",
    goNoGo,
    "",
    "### draft.v1 — foundation-summary.md candidate",
    summary,
  ].join("\n");

  return {
    schema_version: DRAFT_SCHEMA_VERSION,
    spec_md_v3: specV3,
    go_no_go_md: goNoGo,
    foundation_summary_md: summary,
    text,
  };
}

/**
 * Convenience composer used by the host to attach pre-collected evidence to
 * the system-prompt append. Returns a string that is safe to concatenate
 * with `buildFoundationSummarySystemPrompt()` output. Empty evidence
 * returns an empty string so prompts stay clean when no workspace exists.
 */
export function formatEvidenceContextBlock(evidence) {
  if (!evidence || evidence.workspace_root === "") return "";
  const draft = buildFoundationSummaryDraftV1(evidence);
  const lines = [
    "## Workspace Evidence Snapshot (Sub-AC 2)",
    `- collected_at: ${evidence.collected_at}`,
    `- artifacts_completeness: ${(evidence.artifacts_completeness * 100).toFixed(0)}%`,
    `- spec_versions_present: ${evidence.spec_versions_present.join(", ") || "(none)"}`,
    `- monetization_signal: ${evidence.monetization_signal}`,
    `- recommended_go_no_go: ${evidence.go_no_go_recommendation}`,
    "",
    "사전에 수집된 draft.v1을 기반으로 응답해. 누락된 산출물은 거짓말로 채우지 말고 사용자에게 다시 물어.",
    "",
    draft.text,
  ];
  return lines.join("\n");
}

// ───────────────────────── internal helpers ─────────────────────────

function emptyEvidence({ workspaceRoot, collectedAt }) {
  const days = [];
  for (let day = 0; day <= 7; day++) {
    const descriptor = FOUNDATION_DAYS[day];
    if (!descriptor) continue;
    days.push({
      day,
      core_question: descriptor.core_question,
      sub_workflow: descriptor.sub_workflow ?? null,
      spec_version: descriptor.spec_version ?? null,
      input_sources: [...(descriptor.input_sources || [])],
      artifacts_expected: [...(descriptor.artifacts || [])],
      artifacts_found: [],
      missing: [...(descriptor.artifacts || [])],
      evidence_refs_count: 0,
    });
  }
  return {
    schema_version: DRAFT_SCHEMA_VERSION,
    workspace_root: workspaceRoot,
    foundation_dir: "",
    foundation_dir_present: false,
    collected_at: collectedAt,
    days,
    spec_versions_expected: ["v0", "v1", "v2", "v3"],
    spec_versions_present: [],
    spec_md: { path: "", present: false, size: 0, mtime: null, headings: [] },
    monetization_ask: {
      artifact: "monetization-ask-result.md",
      path: "",
      present: false,
      classification: null,
      response_yes_count: 0,
      payment_executed: null,
      excerpt: "",
    },
    evidence_sidecars: { dir: "", present: false, files: [], total: 0 },
    artifacts_completeness: 0,
    monetization_signal: "missing",
    missing_inputs: [],
    go_no_go_recommendation: "restart",
    go_no_go_reason: "workspace 비어있음 — Day 0부터 다시 시작 필요.",
  };
}

async function pathExists(fs, p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function safeStat(fs, p) {
  try {
    const stat = await fs.stat(p);
    if (stat.isFile()) return stat;
    return null;
  } catch {
    return null;
  }
}

async function safeReadExcerpt(fs, p, maxChars) {
  try {
    const buf = await fs.readFile(p, "utf8");
    if (typeof buf !== "string") return "";
    const trimmed = buf.trim();
    if (trimmed.length <= maxChars) return trimmed;
    return `${trimmed.slice(0, maxChars)}…`;
  } catch {
    return "";
  }
}

async function readSpecMdInfo(fs, foundationDir) {
  const abs = path.join(foundationDir, "SPEC.md");
  const stat = await safeStat(fs, abs);
  if (!stat) {
    return { path: abs, present: false, size: 0, mtime: null, headings: [] };
  }
  let body = "";
  try {
    body = await fs.readFile(abs, "utf8");
  } catch {
    body = "";
  }
  const headings = [];
  const lines = String(body || "").split(/\r?\n/);
  for (const line of lines) {
    const m = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (m) headings.push(`${"#".repeat(m[1].length)} ${m[2]}`);
    if (headings.length >= HEADING_CAP) break;
  }
  return {
    path: abs,
    present: true,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    headings,
  };
}

function computeSpecVersionsPresent({ days, specMd }) {
  // A version is "present" if (a) the day producing it has SPEC.md in its
  // artifacts_found AND (b) SPEC.md is on disk. We don't try to parse
  // version sentinels — that's the job of the agent during the prompt.
  if (!specMd?.present) return [];
  const present = [];
  for (const day of days) {
    if (!day.spec_version) continue;
    const hasSpec = day.artifacts_found.some((a) => a.file === "SPEC.md");
    if (hasSpec && !present.includes(day.spec_version)) {
      present.push(day.spec_version);
    }
  }
  // If SPEC.md exists on disk at all we minimally claim v0 — but only if
  // Day 1's SPEC artifact was found, otherwise we stay honest.
  return present;
}

async function collectEvidenceSidecars(fs, evidenceDir) {
  const present = await pathExists(fs, evidenceDir);
  if (!present) {
    return { dir: evidenceDir, present: false, files: [], total: 0 };
  }
  const files = [];
  try {
    const sessions = await fs.readdir(evidenceDir);
    for (const session of sessions) {
      if (files.length >= SIDECAR_LIST_CAP) break;
      const sessionDir = path.join(evidenceDir, session);
      const sessionStat = await safeStatLoose(fs, sessionDir);
      if (!sessionStat || !sessionStat.isDirectory()) continue;
      let entries = [];
      try {
        entries = await fs.readdir(sessionDir);
      } catch {
        entries = [];
      }
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        if (files.length >= SIDECAR_LIST_CAP) break;
        const abs = path.join(sessionDir, entry);
        const parsed = await safeReadJson(fs, abs);
        if (!parsed) continue;
        files.push({
          path: abs,
          session_id: parsed.session_id ?? session,
          message_id: parsed.message_id ?? entry.replace(/\.json$/, ""),
          day: typeof parsed.day === "number" ? parsed.day : null,
          sub_workflow: parsed.sub_workflow ?? null,
          overall_confidence:
            typeof parsed.overall_confidence === "number"
              ? parsed.overall_confidence
              : null,
        });
      }
    }
  } catch {
    /* ignore — present=true with empty files is still informative */
  }
  return { dir: evidenceDir, present: true, files, total: files.length };
}

async function safeStatLoose(fs, p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function safeReadJson(fs, p) {
  try {
    const text = await fs.readFile(p, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function collectMonetizationAsk(fs, foundationDir) {
  const file = "monetization-ask-result.md";
  const abs = path.join(foundationDir, file);
  const stat = await safeStat(fs, abs);
  if (!stat) {
    return {
      artifact: file,
      path: abs,
      present: false,
      classification: null,
      response_yes_count: 0,
      payment_executed: null,
      excerpt: "",
    };
  }
  let body = "";
  try {
    body = await fs.readFile(abs, "utf8");
  } catch {
    body = "";
  }
  const classification = parseMonetizationClassification(body);
  const yesCount = countMonetizationYes(body);
  const paymentExecuted = parsePaymentExecuted(body);
  return {
    artifact: file,
    path: abs,
    present: true,
    classification,
    response_yes_count: yesCount,
    payment_executed: paymentExecuted,
    excerpt: body.slice(0, ARTIFACT_EXCERPT_CHARS),
  };
}

function parseMonetizationClassification(body) {
  if (!body) return null;
  // Match the canonical classifications even if surrounded by markdown.
  // Word-boundary safe; case-insensitive on the classification keyword.
  const m = /response[_\s-]*classification\s*[:=]\s*"?(yes|no_reply|maybe|no)"?/i.exec(body);
  if (m) return m[1].toLowerCase();
  // Fallback: bare "classification: yes" line.
  const m2 = /classification\s*[:=]\s*"?(yes|no_reply|maybe|no)"?/i.exec(body);
  return m2 ? m2[1].toLowerCase() : null;
}

function countMonetizationYes(body) {
  if (!body) return 0;
  const re = /response[_\s-]*classification\s*[:=]\s*"?yes"?|^\s*-\s*classification\s*[:=]\s*"?yes"?/gim;
  let count = 0;
  let m;
  while ((m = re.exec(body)) !== null) {
    count += 1;
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return count;
}

function parsePaymentExecuted(body) {
  if (!body) return null;
  const m = /payment[_\s-]*executed\s*[:=]\s*"?(true|false|yes|no)"?/i.exec(body);
  if (!m) return null;
  const v = m[1].toLowerCase();
  return v === "true" || v === "yes";
}

function recommendGoNoGo({ monetization, completeness, days }) {
  // Day 6 monetization-ask is the primary go/no-go signal.
  if (!monetization.present) {
    return {
      recommendation: "restart",
      reason: "monetization-ask-result.md 없음 — Day 6 명시적 ask 미수행.",
    };
  }
  if (monetization.classification === "yes" || monetization.response_yes_count >= 1) {
    return {
      recommendation: "continue",
      reason: `monetization yes ${monetization.response_yes_count || 1}건 — 가설 유효, Build phase 진입 권고.`,
    };
  }
  // Distinguish "tried but rejected" (pivot) from "never finished" (restart).
  const hasMost = completeness >= 0.7;
  if (monetization.classification === "no") {
    return {
      recommendation: hasMost ? "pivot" : "restart",
      reason: hasMost
        ? "monetization no — Foundation 산출물은 충분, 가설 반증 → Pivot 권고."
        : "monetization no + 산출물 부족 — Foundation 재시작 권고.",
    };
  }
  if (monetization.classification === "no_reply" || monetization.classification === "maybe") {
    return {
      recommendation: "restart",
      reason: `monetization ${monetization.classification} — 명시적 결제 신호 부재, 다른 타겟으로 Day 6 재실행.`,
    };
  }
  // Classification missing despite file presence → likely incomplete artifact.
  if (days.some((d) => d.missing.length > 0)) {
    return {
      recommendation: "restart",
      reason: "monetization 분류 미상 + 누락 산출물 존재 — Day 6 결과 정리 후 재판정.",
    };
  }
  return {
    recommendation: "restart",
    reason: "monetization 분류 미상 — monetization-ask-result.md 형식 보강 필요.",
  };
}

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// ───────────────────────── draft renderers ─────────────────────────

function renderSpecMdV3Draft(evidence) {
  const lines = [];
  lines.push("# SPEC v3 (draft.v1)");
  lines.push("");
  lines.push("> Auto-drafted from Day 0-6 artifacts. Edit and confirm before commit.");
  lines.push("");
  lines.push("## 가설 진화");
  for (const day of evidence.days) {
    if (!day.spec_version) continue;
    const found = day.artifacts_found.find((a) => a.file === "SPEC.md");
    const status = found ? `present (size=${found.size})` : "MISSING";
    lines.push(`- Day ${day.day} → SPEC ${day.spec_version}: ${status}`);
  }
  lines.push("");
  lines.push("## 핵심 통증 (Day 1)");
  appendDayExcerpt(lines, evidence, 1, "day-1-pain-summary.md");
  lines.push("");
  lines.push("## 인터뷰 검증/반증 (Day 3)");
  appendDayExcerpt(lines, evidence, 3, "day-3-interview-script.md");
  lines.push("");
  lines.push("## 광고 수요 시그널 (Day 5)");
  appendDayExcerpt(lines, evidence, 5, "day-5-demand-signal.md");
  lines.push("");
  lines.push("## monetization 결과 (Day 6)");
  if (evidence.monetization_ask.present) {
    lines.push(`- classification: ${evidence.monetization_ask.classification ?? "(미분류)"}`);
    lines.push(`- response_yes_count: ${evidence.monetization_ask.response_yes_count}`);
    if (evidence.monetization_ask.payment_executed !== null) {
      lines.push(`- payment_executed: ${evidence.monetization_ask.payment_executed}`);
    }
    if (evidence.monetization_ask.excerpt) {
      lines.push("```");
      lines.push(evidence.monetization_ask.excerpt);
      lines.push("```");
    }
  } else {
    lines.push("- monetization-ask-result.md 없음.");
  }
  return lines.join("\n");
}

function renderGoNoGoDraft(evidence) {
  const lines = [];
  lines.push("# go-no-go.md (draft.v1)");
  lines.push("");
  lines.push(`결정: ${decisionLabel(evidence.go_no_go_recommendation)}`);
  lines.push("");
  lines.push("## 근거");
  lines.push(`- ${evidence.go_no_go_reason}`);
  lines.push(`- artifacts_completeness: ${(evidence.artifacts_completeness * 100).toFixed(0)}%`);
  lines.push(`- spec_versions_present: ${evidence.spec_versions_present.join(", ") || "(none)"}`);
  lines.push(`- monetization_signal: ${evidence.monetization_signal}`);
  if (evidence.monetization_ask.present) {
    lines.push(`- monetization_yes_count: ${evidence.monetization_ask.response_yes_count}`);
  }
  lines.push("");
  lines.push("## 누락 산출물");
  if (evidence.missing_inputs.length === 0) {
    lines.push("- 없음.");
  } else {
    for (const m of evidence.missing_inputs) {
      lines.push(`- Day ${m.day} :: ${m.file} (${m.reason})`);
    }
  }
  return lines.join("\n");
}

function renderFoundationSummaryDraft(evidence) {
  const lines = [];
  lines.push("# foundation-summary.md (draft.v1)");
  lines.push("");
  lines.push(`- workspace: ${evidence.workspace_root || "(unknown)"}`);
  lines.push(`- collected_at: ${evidence.collected_at}`);
  lines.push(`- artifacts_completeness: ${(evidence.artifacts_completeness * 100).toFixed(0)}%`);
  lines.push(`- evidence_sidecars: ${evidence.evidence_sidecars.total}`);
  lines.push(`- recommendation: ${decisionLabel(evidence.go_no_go_recommendation)}`);
  lines.push("");
  lines.push("## Day-by-Day 산출물 점검");
  for (const day of evidence.days) {
    const foundFiles = day.artifacts_found.map((a) => a.file).join(", ");
    const missingFiles = day.missing.join(", ");
    lines.push(
      `- Day ${day.day} (${day.sub_workflow ?? "no-subworkflow"}): found=[${foundFiles || "-"}] missing=[${missingFiles || "-"}] refs=${day.evidence_refs_count}`,
    );
  }
  if (evidence.missing_inputs.length > 0) {
    lines.push("");
    lines.push("## 다음 액션");
    lines.push("- 누락된 산출물 채운 뒤 Day 7 summary 재실행.");
  }
  return lines.join("\n");
}

function appendDayExcerpt(lines, evidence, day, file) {
  const bucket = evidence.days.find((d) => d.day === day);
  if (!bucket) {
    lines.push(`- Day ${day} 정보 없음.`);
    return;
  }
  const found = bucket.artifacts_found.find((a) => a.file === file);
  if (!found || !found.excerpt) {
    lines.push(`- ${file} 없음 — 채워서 다시 와.`);
    return;
  }
  lines.push("```");
  lines.push(found.excerpt);
  lines.push("```");
}

function decisionLabel(rec) {
  switch (rec) {
    case "continue":
      return "계속 (Build phase 진입)";
    case "pivot":
      return "피벗 (가설 변경)";
    case "restart":
      return "재시작 (Foundation 재실행)";
    default:
      return rec;
  }
}

export const __test__ = Object.freeze({
  parseMonetizationClassification,
  countMonetizationYes,
  parsePaymentExecuted,
  recommendGoNoGo,
});

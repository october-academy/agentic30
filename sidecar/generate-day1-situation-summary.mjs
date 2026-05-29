// Day-1 "project situation" summary — the headline Day-1 deliverable.
//
// Composes a multi-angle read of the project from everything we know:
//   - onboarding hypothesis (README/docs/source signals)
//   - recent agent work (~/.claude + ~/.codex digest)
//   - recent git commit subjects
//   - README ↔ reality drift
// into: 3 short angles (product / engineering / recent focus), a README update
// suggestion, ≤3 next-action chips, and a button-first goal-concretization
// decision (short, balanced options — per the Day-1 UX rule).
//
// Pattern mirrors generate-day1-icp-plan.mjs: deterministic assembly is the
// always-available floor; composeDay1SituationSummary() may refine via Claude
// (read-only) and falls back to deterministic on any failure.

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";

import { redactSecrets } from "./workspace-safety.mjs";
import { detectReadmeDrift } from "./readme-drift.mjs";

export const DAY1_SITUATION_SUMMARY_SCHEMA_VERSION = 1;

const ANGLE_MAX = 200;
const ACTION_LABEL_MAX = 40;
const README_MAX_CHARS = 6_000;

const KIND_LABELS = {
  mac_app: "macOS 앱",
  web_app: "웹 앱",
  developer_tool: "개발자 도구",
  node_app: "Node.js 프로젝트",
  strategy_docs: "전략 문서 프로젝트",
};

const GoalDecisionSchema = z.object({
  header: z.string().optional(),
  question: z.string().min(1),
  options: z.array(z.object({ label: z.string().min(1), description: z.string().optional() })).min(1),
  multiSelect: z.boolean().optional(),
  allowFreeText: z.boolean().optional(),
  freeTextPlaceholder: z.string().optional(),
  textMode: z.enum(["short", "long"]).optional(),
}).passthrough();

export const Day1SituationSummarySchema = z.object({
  schemaVersion: z.literal(DAY1_SITUATION_SUMMARY_SCHEMA_VERSION),
  source: z.string().optional(),
  generatedAt: z.string().optional(),
  angles: z.object({
    product: z.string().min(1),
    engineering: z.string().min(1),
    recentFocus: z.string().min(1),
  }),
  readmeUpdate: z.object({
    hasDrift: z.boolean(),
    suggestion: z.string(),
    missing: z.array(z.string()),
    stale: z.array(z.string()),
  }),
  nextActions: z.array(z.object({ label: z.string().min(1), rationale: z.string().optional() })).max(3),
  goalDecision: GoalDecisionSchema,
  provenance: z.object({}).passthrough(),
  confidence: z.number().min(0).max(1),
}).passthrough();

function clamp(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trim()}…`;
}

function userFacingName(hypothesis) {
  const name = String(hypothesis?.productName || "").trim();
  if (!name || /workspace-[a-z0-9]{4,}$/i.test(name) || /^(tmp|temp|test)[-_]/i.test(name)) {
    return "이 프로젝트";
  }
  return name;
}

// ---------------------------------------------------------------------------
// Deterministic assembly (pure)
// ---------------------------------------------------------------------------

export function generateDay1SituationSummary({
  onboardingHypothesis = {},
  agentHistory = null,
  recentCommitSubjects = [],
  driftFindings = null,
  now = new Date(),
} = {}) {
  const h = onboardingHypothesis || {};
  const name = userFacingName(h);
  const kindLabel = KIND_LABELS[h.projectKind] || "프로젝트";
  const commitCount = recentCommitSubjects.length;
  const history = agentHistory && agentHistory.recentIntents ? agentHistory : null;
  const drift = driftFindings || detectReadmeDrift({});

  // angle: product / goal
  const productBits = [];
  productBits.push(`${name}은(는) ${kindLabel}`);
  if (h.purpose) productBits.push(h.purpose);
  else if (h.goal) productBits.push(`목표: ${h.goal}`);
  if (h.targetUser) productBits.push(`대상: ${h.targetUser}`);
  const product = clamp(productBits.join(" · "), ANGLE_MAX);

  // angle: engineering state
  const engBits = [];
  engBits.push(kindLabel);
  if (commitCount) engBits.push(`최근 ${commitCount}개 커밋`);
  if (history?.filesTouched?.length) engBits.push(`${history.filesTouched.length}개 파일 변경`);
  if (h.stage && h.stage !== "unknown") engBits.push(`단계: ${stageLabel(h.stage)}`);
  const topFiles = history?.filesTouched?.slice(0, 3).map((f) => f.file) || [];
  if (topFiles.length) engBits.push(`핫스팟: ${topFiles.join(", ")}`);
  const engineering = clamp(engBits.join(" · "), ANGLE_MAX);

  // angle: recent focus / momentum
  let recentFocus;
  if (history?.recentIntents?.length) {
    const top = history.recentIntents.slice(0, 2).map((i) => i.text);
    const providers = history.providers.join("+");
    recentFocus = clamp(
      `최근 작업(${providers}, ${history.sessionCount}세션): ${top.join(" / ")}`,
      ANGLE_MAX,
    );
  } else if (commitCount) {
    recentFocus = clamp(`최근 커밋 흐름: ${recentCommitSubjects.slice(0, 3).join(" / ")}`, ANGLE_MAX);
  } else {
    recentFocus = "최근 작업 신호가 부족해요. 오늘 한 가지 행동으로 시작해 보세요.";
  }

  const readmeUpdate = {
    hasDrift: drift.driftScore > 0,
    suggestion: drift.suggestion,
    missing: drift.missingFromReadme.map((f) => f.term).slice(0, 5),
    stale: drift.staleInReadme.map((f) => f.claim).slice(0, 3),
  };

  const nextActions = buildNextActions({ hypothesis: h, drift, history });
  const goalDecision = buildGoalDecision(h);

  const provenance = {
    usedAgentHistory: Boolean(history),
    providers: history?.providers || [],
    sessionCount: history?.sessionCount || 0,
    commitCount,
    readmePresent: drift.hasReadme,
  };

  const confidence = scoreConfidence({ hypothesis: h, history, commitCount, drift });

  return {
    schemaVersion: DAY1_SITUATION_SUMMARY_SCHEMA_VERSION,
    source: "deterministic",
    generatedAt: now.toISOString(),
    angles: { product, engineering, recentFocus },
    readmeUpdate,
    nextActions,
    goalDecision,
    provenance,
    confidence,
  };
}

function stageLabel(stage) {
  switch (stage) {
    case "idea": return "아이디어";
    case "prototype": return "프로토타입";
    case "first_users": return "초기 사용자";
    case "pre_revenue": return "매출 전";
    case "post_revenue": return "매출 후";
    default: return stage;
  }
}

function buildNextActions({ hypothesis, drift, history }) {
  const actions = [];
  if (drift.missingFromReadme.length) {
    actions.push({
      label: "README 최신화",
      rationale: `최근 작업(${drift.missingFromReadme.map((f) => f.term).slice(0, 3).join(", ")})이 README에 없어요`,
    });
  }
  if (!hypothesis.targetUser || hypothesis.confidence === "low") {
    actions.push({ label: "ICP 한 줄 고정", rationale: "타깃 고객이 아직 흐릿해요" });
  }
  if (history?.recentIntents?.length) {
    actions.push({ label: "오늘 작업 이어가기", rationale: clamp(history.recentIntents[0].text, 60) });
  }
  if (!actions.length) {
    actions.push({ label: "30일 목표 고정", rationale: "측정 가능한 목표 한 줄부터" });
  }
  return actions.slice(0, 3).map((a) => ({ label: clamp(a.label, ACTION_LABEL_MAX), rationale: clamp(a.rationale || "", 90) }));
}

function buildGoalDecision(hypothesis) {
  const options = [];
  const goal = String(hypothesis.goal || "").trim();
  if (goal) options.push({ label: clamp(goal, 30), description: "현재 추정 목표 유지" });
  options.push({ label: "첫 매출", description: "수익을 30일 목표로" });
  options.push({ label: "사용자 100명", description: "활성 사용자 100명 목표" });
  // de-dup by label, keep <=3 balanced options
  const seen = new Set();
  const deduped = options.filter((o) => {
    const k = o.label.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 3);
  return {
    header: "30일 목표",
    question: "30일 목표를 한 줄로 고정할까요?",
    options: deduped,
    multiSelect: false,
    allowFreeText: true,
    freeTextPlaceholder: "직접 입력",
    textMode: "short",
  };
}

function scoreConfidence({ hypothesis, history, commitCount, drift }) {
  let score = 0.3;
  if (hypothesis.confidence === "high") score += 0.3;
  else if (hypothesis.confidence === "medium") score += 0.15;
  if (history?.recentIntents?.length) score += 0.2;
  if (commitCount > 0) score += 0.1;
  if (drift.hasReadme) score += 0.1;
  return Math.min(1, Number(score.toFixed(2)));
}

// ---------------------------------------------------------------------------
// I/O wrapper — gathers README + commits, then assembles. (index.mjs entry)
// ---------------------------------------------------------------------------

export async function buildDay1SituationSummary({
  workspaceRoot,
  onboardingHypothesis = {},
  agentHistory = null,
  now = new Date(),
  fsImpl = fs,
  gitSubjectsImpl = readRecentGitSubjects,
} = {}) {
  const readme = await readReadme(workspaceRoot, fsImpl);
  const recentCommitSubjects = await gitSubjectsImpl(workspaceRoot).catch(() => []);
  const agentIntents = (agentHistory?.recentIntents || []).map((i) => i.text);
  const filesTouched = agentHistory?.filesTouched || [];
  const driftFindings = detectReadmeDrift({ readme, recentCommitSubjects, agentIntents, filesTouched });
  return generateDay1SituationSummary({
    onboardingHypothesis,
    agentHistory,
    recentCommitSubjects,
    driftFindings,
    now,
  });
}

async function readReadme(workspaceRoot, fsImpl) {
  for (const name of ["README.md", "readme.md", "Readme.md", "README"]) {
    try {
      const content = await fsImpl.readFile(path.join(workspaceRoot, name), "utf8");
      return redactSecrets(content.slice(0, README_MAX_CHARS));
    } catch {
      /* try next */
    }
  }
  return "";
}

function readRecentGitSubjects(root, { sinceDays = 30, limit = 60, timeoutMs = 2_000 } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(
        "git",
        ["-C", root, "log", `--since=${sinceDays}.days`, "--pretty=%s", `-n`, String(limit)],
        { cwd: root, stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      resolve([]);
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* noop */ }
      resolve(splitLines(out));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.length > 16_000) { try { child.kill("SIGKILL"); } catch { /* noop */ } }
    });
    child.on("error", () => { clearTimeout(timer); resolve([]); });
    child.on("close", () => { clearTimeout(timer); resolve(splitLines(out)); });
  });
}

function splitLines(text) {
  return String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 60);
}

// ---------------------------------------------------------------------------
// Optional Claude refinement (read-only); falls back to deterministic.
// ---------------------------------------------------------------------------

export async function composeDay1SituationSummary({
  deterministic,
  queryImpl = null,
  parseImpl = null,
} = {}) {
  // LLM refinement is wired but defaults to the deterministic summary. When a
  // queryImpl is supplied (Claude Agent SDK, read-only), a future revision can
  // refine the prose angles; any parse/validation failure must return the
  // deterministic floor unchanged.
  if (typeof queryImpl !== "function" || typeof parseImpl !== "function") {
    return { ...deterministic, source: deterministic.source || "deterministic" };
  }
  try {
    const refined = await parseImpl(await queryImpl(deterministic));
    const validated = Day1SituationSummarySchema.safeParse(refined);
    if (validated.success) {
      return { ...validated.data, source: "llm" };
    }
  } catch {
    /* fall through */
  }
  return { ...deterministic, source: deterministic.source || "deterministic" };
}

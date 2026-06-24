#!/usr/bin/env node
/**
 * One measurement cycle of the autonomous improve-loop.
 *
 * Runs the real-project Office Hours arc (LIVE codex) for each configured user
 * project, judges each capture on the 6 dogfood dimensions against Agentic30's
 * own ICP/VALUES/GOAL, then aggregates a cycle score + identifies the weakest
 * dimension to guide the next improvement. Projects run sequentially to avoid
 * concurrent-codex rate limits.
 *
 * Usage:
 *   AGENTIC30_RUN_LIVE_PROVIDER_EVAL=1 node sidecar-evals/run-cycle.mjs \
 *     --cycle 0 --days 1 --max-turns 6 --out sidecar-evals/.artifacts/cycle-0.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRealProjectArc } from "./real-project-arc.mjs";
import { judgeCapture } from "./judge-real-arc.mjs";
import { loadReferenceDocs, SCORE_KEYS } from "./dogfood-judge.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.resolve(packageRoot, "..", "..");

// User projects to simulate. dongdong = real thin-context project (PDF only);
// agentic30 = the product itself with rich synthesized context from its docs.
const PROJECTS = [
  // Domain-matched persona so the measurement reflects card→customer fit, not a
  // persona/domain mismatch (dongdong is a Buddhist mindfulness app, not a dev tool).
  { label: "dongdong", projectPath: path.resolve(packageRoot, "..", "dongdong"), personaId: "mindfulness-app" },
  {
    label: "agentic30",
    projectPath: packageRoot,
    personaId: "icp-solo-dev",
    goalOverride: "AGENTIC30_GOAL_FILE",
    projectContextOverride: "AGENTIC30_CONTEXT_FILE",
  },
];

async function loadJsonMaybe(p) {
  if (!p) return null;
  try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return null; }
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = { cycle: 0, days: [1], maxTurns: 6 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cycle") opts.cycle = Number(argv[++i]);
    else if (argv[i] === "--days") opts.days = argv[++i].split(",").map((d) => Number(d.trim())).filter(Boolean);
    else if (argv[i] === "--max-turns") opts.maxTurns = Number(argv[++i]);
    else if (argv[i] === "--out") opts.out = argv[++i];
    else if (argv[i] === "--goal-file") opts.goalFile = argv[++i];
    else if (argv[i] === "--context-file") opts.contextFile = argv[++i];
  }
  const goalOverride = await loadJsonMaybe(opts.goalFile);
  const contextOverride = await loadJsonMaybe(opts.contextFile);
  const referenceDocs = await loadReferenceDocs(packageRoot);

  const results = [];
  for (const proj of PROJECTS) {
    const t0 = Date.now();
    let captured, judged;
    try {
      const arc = await runRealProjectArc(proj.projectPath, {
        mode: "live",
        label: proj.label,
        personaId: proj.personaId || "icp-solo-dev",
        days: opts.days,
        maxTurnsPerDay: opts.maxTurns,
        goalOverride: proj.goalOverride ? goalOverride : null,
        projectContextOverride: proj.projectContextOverride ? contextOverride : null,
      });
      captured = arc.captured;
      judged = await judgeCapture({ capturedPath: path.join(arc.runDir, "captured.json"), referenceDocs });
    } catch (e) {
      results.push({ label: proj.label, error: e.message });
      continue;
    }
    const v = judged.verdict;
    results.push({
      label: proj.label,
      elapsedSec: Math.round((Date.now() - t0) / 1000),
      cardCount: judged.cardCount,
      dayOutcomes: (captured.days || []).map((d) => `day${d.day}:${d.outcome}`),
      arcErrors: captured.errors,
      overall: v.overall,
      scores: v.scores,
      judge_summary: v.judge_summary,
      regressions: v.regressions,
      judge_status: v.judge_status,
    });
  }

  // Aggregate: cross-project mean per dimension + overall + weakest dimension.
  const scored = results.filter((r) => r.scores);
  const dimMeans = {};
  for (const k of SCORE_KEYS) {
    const vals = scored.map((r) => r.scores[k]).filter((n) => typeof n === "number");
    dimMeans[k] = vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
  }
  const overalls = scored.map((r) => r.overall).filter((n) => typeof n === "number");
  const cycleOverall = overalls.length ? Number((overalls.reduce((a, b) => a + b, 0) / overalls.length).toFixed(2)) : null;
  const weakest = Object.entries(dimMeans)
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => a[1] - b[1])[0] || null;

  const report = {
    cycle: opts.cycle,
    at: new Date().toISOString(),
    days: opts.days,
    maxTurns: opts.maxTurns,
    cycleOverall,
    dimMeans,
    weakestDimension: weakest ? { key: weakest[0], mean: weakest[1] } : null,
    target: 9.5,
    reached: typeof cycleOverall === "number" && cycleOverall >= 9.5,
    projects: results,
  };
  const out = opts.out || path.join(packageRoot, "sidecar-evals", ".artifacts", `cycle-${opts.cycle}.json`);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2) + "\n");

  console.log(`\n=== CYCLE ${opts.cycle} ===`);
  console.log(`cycleOverall: ${cycleOverall} (target 9.5, reached=${report.reached})`);
  console.log(`dimMeans: ${SCORE_KEYS.map((k) => `${k}=${dimMeans[k]}`).join(" ")}`);
  console.log(`weakest: ${weakest ? `${weakest[0]} (${weakest[1]})` : "n/a"}`);
  for (const r of results) {
    console.log(`  [${r.label}] overall=${r.overall ?? r.error} cards=${r.cardCount ?? "-"} outcomes=${(r.dayOutcomes || []).join(",")}`);
  }
  console.log(`report → ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

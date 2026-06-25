#!/usr/bin/env node
/**
 * GPT-5.5 Pro prerequisite diagnostic: re-judge ONE frozen capture N times to
 * separate JUDGE variance from generation variance. No LIVE arc re-run — the
 * capture is fixed, only the judge LLM call repeats. Prints per-dimension and
 * overall mean/sd so we can decide whether median-of-N judging is required before
 * trusting any score delta. Usage:
 *   AGENTIC30_RUN_LIVE_PROVIDER_EVAL=1 node sidecar-evals/judge-variance-probe.mjs --captured <path> --n 5
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeCapture } from "./judge-real-arc.mjs";
import { loadReferenceDocs, SCORE_KEYS } from "./dogfood-judge.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stats(xs) {
  const v = xs.filter((n) => typeof n === "number");
  if (!v.length) return { mean: null, sd: null, min: null, max: null, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { mean: Number(mean.toFixed(3)), sd: Number(sd.toFixed(3)), min: Math.min(...v), max: Math.max(...v), n: v.length };
}

async function main() {
  const argv = process.argv.slice(2);
  let capturedPath = null; let n = 5;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--captured") capturedPath = argv[++i];
    else if (argv[i] === "--n") n = Number(argv[++i]);
  }
  if (!capturedPath) { console.error("usage: --captured <path> [--n 5]"); process.exit(2); }
  const referenceDocs = await loadReferenceDocs(packageRoot);
  const runs = [];
  for (let i = 0; i < n; i++) {
    try {
      const r = await judgeCapture({ capturedPath, referenceDocs });
      const v = r.verdict;
      runs.push({ overall: v.overall, scores: v.scores || {}, status: v.judge_status });
      console.log(`run ${i + 1}/${n}: overall=${v.overall} | ${SCORE_KEYS.map((k) => `${k}=${v.scores?.[k] ?? "?"}`).join(" ")}`);
    } catch (e) {
      console.log(`run ${i + 1}/${n}: ERROR ${e.message}`);
      runs.push({ overall: null, scores: {}, error: e.message });
    }
  }
  console.log("\n=== JUDGE VARIANCE (frozen capture, repeated judging) ===");
  console.log(`capture: ${capturedPath}`);
  const overallStats = stats(runs.map((r) => r.overall));
  console.log(`overall: mean=${overallStats.mean} sd=${overallStats.sd} range=[${overallStats.min},${overallStats.max}] n=${overallStats.n}`);
  for (const k of SCORE_KEYS) {
    const s = stats(runs.map((r) => r.scores[k]));
    console.log(`  ${k}: mean=${s.mean} sd=${s.sd} range=[${s.min},${s.max}]`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

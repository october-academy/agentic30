#!/usr/bin/env node
// Evaluator wrapper for autoresearch mission `day1to3-goal-alignment`.
// Runs sidecar-evals/dogfood-simulation.mjs in offline (stub) AND live modes,
// then prints a single JSON line on stdout:
//   {"pass": boolean, "score": number, "details": {...}}
//
// Env:
//   AGENTIC30_RUN_LIVE_PROVIDER_EVAL is set automatically for the live half.
//   AUTORESEARCH_SKIP_LIVE=1 — debugging only; skips the live half and forces pass=false.
//   Live half requires Claude Code login or ANTHROPIC_API_KEY available to the spawned sidecar.

import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ARTIFACTS_DIR = path.join(ROOT, "sidecar-evals", ".artifacts");

function runSim(extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["sidecar-evals/dogfood-simulation.mjs", "--gate"],
      {
        env: { ...process.env, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function findLatestRunDir(afterMs) {
  const entries = await readdir(ARTIFACTS_DIR, { withFileTypes: true }).catch(() => []);
  let latest = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(ARTIFACTS_DIR, entry.name);
    const s = await stat(dir).catch(() => null);
    if (!s) continue;
    if (s.mtimeMs <= afterMs) continue;
    if (!latest || s.mtimeMs > latest.mtime) {
      latest = { dir, mtime: s.mtimeMs };
    }
  }
  return latest;
}

async function parseResults(runDir) {
  const file = path.join(runDir, "results.jsonl");
  const text = await readFile(file, "utf8");
  const lines = text.split("\n").filter(Boolean);
  const records = lines.map((l) => JSON.parse(l));
  const verdicts = records.map((r) => r.verdict);
  const overalls = records
    .map((r) => (typeof r.overall === "number" ? r.overall : null))
    .filter((v) => v !== null);
  return { records, verdicts, overalls };
}

function countBy(arr) {
  return arr.reduce((m, v) => {
    m[v] = (m[v] || 0) + 1;
    return m;
  }, {});
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

async function main() {
  const startMs = Date.now() - 1000;

  // OFFLINE half — stub provider, verdict-based pass.
  const offline = await runSim({});
  const offlineRun = await findLatestRunDir(startMs);
  if (!offlineRun) {
    return emit({
      pass: false,
      score: 0,
      details: { error: "offline run produced no artifacts", code: offline.code },
    });
  }
  const offRes = await parseResults(offlineRun.dir);
  const offlinePass =
    offRes.verdicts.length > 0 &&
    offRes.verdicts.every((v) => v === "SMOKE_PASS" || v === "JUDGE_PASS");

  // LIVE half — real provider, JUDGE-rubric scoring.
  const skipLive = process.env.AUTORESEARCH_SKIP_LIVE === "1";
  let liveRes = null;
  let livePass = false;
  let liveRunDir = null;
  if (!skipLive) {
    const liveStart = Date.now() - 1000;
    await runSim({ AGENTIC30_RUN_LIVE_PROVIDER_EVAL: "1" });
    const liveRun = await findLatestRunDir(liveStart);
    if (!liveRun) {
      return emit({
        pass: false,
        score: 0,
        details: {
          error: "live run produced no artifacts",
          offline_pass: offlinePass,
          offline_run_dir: offlineRun.dir,
        },
      });
    }
    liveRes = await parseResults(liveRun.dir);
    liveRunDir = liveRun.dir;
    livePass = liveRes.verdicts.length > 0 && liveRes.verdicts.every((v) => v === "JUDGE_PASS");
  }

  const liveAvg =
    liveRes && liveRes.overalls.length
      ? liveRes.overalls.reduce((a, b) => a + b, 0) / liveRes.overalls.length
      : 0;

  emit({
    pass: offlinePass && livePass,
    score: liveAvg,
    details: {
      offline: {
        run_dir: offlineRun.dir,
        scenarios: offRes.records.length,
        all_smoke_pass: offlinePass,
        verdicts: countBy(offRes.verdicts),
      },
      live: skipLive
        ? { skipped: true }
        : {
            run_dir: liveRunDir,
            scenarios: liveRes.records.length,
            all_judge_pass: livePass,
            verdicts: countBy(liveRes.verdicts),
            overall_avg: liveAvg,
          },
    },
  });
}

main().catch((err) => {
  emit({
    pass: false,
    score: 0,
    details: { error: String((err && err.message) || err) },
  });
  process.exit(0);
});

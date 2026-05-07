#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultArtifactsDir = path.join(packageRoot, "sidecar-evals", ".artifacts");

export async function readResultsJsonl(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function findDogfoodResultFiles(artifactsDir = defaultArtifactsDir) {
  let entries = [];
  try {
    entries = await fs.readdir(artifactsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(artifactsDir, entry.name, "results.jsonl");
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) files.push({ filePath, mtimeMs: stat.mtimeMs });
    } catch {
      // Missing partial run.
    }
  }
  return files.sort((lhs, rhs) => rhs.mtimeMs - lhs.mtimeMs).map((entry) => entry.filePath);
}

export function summarizeDogfoodResults(results = []) {
  const verdicts = countBy(results, (result) => result.verdict || "UNKNOWN");
  const judged = results.filter((result) => typeof result.overall === "number");
  const avgOverall = judged.length
    ? round1(judged.reduce((sum, result) => sum + result.overall, 0) / judged.length)
    : null;
  const avgVisibleMs = results.length
    ? Math.round(results.reduce((sum, result) => sum + visibleValueMs(result), 0) / results.length)
    : 0;
  const failures = results
    .filter((result) => result.verdict?.endsWith("_FAIL") || result.regressions?.length)
    .map((result) => ({
      scenario: result.scenario,
      verdict: result.verdict,
      regressions: result.regressions || [],
    }));
  return {
    count: results.length,
    verdicts,
    avg_overall: avgOverall,
    avg_visible_value_ms: avgVisibleMs,
    failures,
  };
}

function visibleValueMs(result) {
  return Number(result?.latency_ms?.first_visible_value_ms ?? result?.latency_ms?.first_visible_value ?? 0);
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  const [filePath] = target
    ? [path.resolve(target)]
    : await findDogfoodResultFiles();
  if (!filePath) {
    console.error("No dogfood results.jsonl file found.");
    process.exit(1);
  }
  const summary = summarizeDogfoodResults(await readResultsJsonl(filePath));
  console.log(JSON.stringify({ file: filePath, ...summary }, null, 2));
}

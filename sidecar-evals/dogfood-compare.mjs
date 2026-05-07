#!/usr/bin/env node
import path from "node:path";
import {
  findDogfoodResultFiles,
  readResultsJsonl,
} from "./dogfood-summary.mjs";

export function compareDogfoodResults(baselineResults = [], currentResults = []) {
  const baselineByScenario = new Map(baselineResults.map((result) => [result.scenario, result]));
  return currentResults.map((current) => {
    const baseline = baselineByScenario.get(current.scenario);
    const currentOverall = optionalNumber(current.overall);
    const baselineOverall = optionalNumber(baseline?.overall);
    const currentVisible = visibleValueMs(current);
    const baselineVisible = visibleValueMs(baseline);
    return {
      scenario: current.scenario,
      verdict_before: baseline?.verdict || null,
      verdict_after: current.verdict || null,
      overall_before: baselineOverall,
      overall_after: currentOverall,
      overall_delta: currentOverall === null || baselineOverall === null
        ? null
        : round1(currentOverall - baselineOverall),
      visible_ms_before: baselineVisible,
      visible_ms_after: currentVisible,
      visible_ms_delta: currentVisible === null || baselineVisible === null
        ? null
        : Math.round(currentVisible - baselineVisible),
      regressions: current.regressions || [],
    };
  });
}

function visibleValueMs(result) {
  return optionalNumber(result?.latency_ms?.first_visible_value_ms ?? result?.latency_ms?.first_visible_value);
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let [baselinePath, currentPath] = process.argv.slice(2).map((item) => item ? path.resolve(item) : "");
  if (!baselinePath || !currentPath) {
    const files = await findDogfoodResultFiles();
    currentPath ||= files[0];
    baselinePath ||= files[1];
  }
  if (!baselinePath || !currentPath) {
    console.error("Need two dogfood results.jsonl files to compare.");
    process.exit(1);
  }
  const baseline = await readResultsJsonl(baselinePath);
  const current = await readResultsJsonl(currentPath);
  console.log(JSON.stringify({
    baseline: baselinePath,
    current: currentPath,
    comparisons: compareDogfoodResults(baseline, current),
  }, null, 2));
}

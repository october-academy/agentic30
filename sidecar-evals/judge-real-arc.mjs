#!/usr/bin/env node
/**
 * Judge a real-project arc capture (from real-project-arc.mjs) on the 6 dogfood
 * dimensions. The judge criteria are ALWAYS Agentic30's own ICP/VALUES/GOAL/SPEC
 * (the product under evaluation); the simulated project is the *user's* project.
 * So a high score means: "Agentic30's office-hours cards serve its ICP and values
 * for this user project," which is exactly the GOAL we iterate toward.
 *
 * Usage: node sidecar-evals/judge-real-arc.mjs --captured <captured.json> [--label X] [--out <scores.json>]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeDogfoodRun, loadReferenceDocs, SCORE_KEYS } from "./dogfood-judge.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function renderCardAsText(card) {
  const opts = (card.options || []).map((o) => `- ${o.label}${o.description ? `: ${o.description}` : ""}`).join("\n");
  return [
    `[Office Hours card · ${card.header || "(no header)"} · signalId=${card.signalId || "-"}]`,
    `Q: ${card.question || ""}`,
    opts ? `Options:\n${opts}` : "(no options)",
    card.allowFreeText ? "(free text allowed)" : "",
  ].filter(Boolean).join("\n");
}

export function buildObservedFromCapture(captured) {
  const cards = [];
  const assistantMessages = [];
  for (const day of captured.days || []) {
    for (const q of day.questions || []) cards.push({ day: day.day, ...q });
    for (const m of day.assistantMessages || []) if (String(m || "").trim()) assistantMessages.push(String(m));
  }
  const cardTexts = cards.map(renderCardAsText);
  // Measurement honesty (R2): the judge reads the reducer-graded ValidationAttempt
  // evidence (office_hours_attempt_evidence), NOT a fabricated strong proof-ledger
  // event. Each transition maps to its HONEST evidence type — record_action_proof is
  // EXECUTION evidence (the action happened), it is NOT yet customer-response or
  // goal-threshold evidence. Over-crediting it as "strong" would recreate the gaming
  // problem under a new schema. Skips/failures are not credited.
  const TRANSITION_EVIDENCE_TYPE = {
    record_action_proof: "execution (action sent; customer response NOT yet observed)",
    record_customer_outcome: "customer-response",
    record_goal_proof: "goal-threshold",
    record_negative_outcome: "valid-negative",
  };
  const attemptSubs = Array.isArray(captured.attemptEvidenceSubmissions) ? captured.attemptEvidenceSubmissions : [];
  const landed = attemptSubs.filter((s) => s && s.success === true && !s.skipped);
  const skipped = attemptSubs.filter((s) => s && s.skipped);
  const evidenceLines = landed.map((s) => `day${s.day}: ${s.transition} → ${TRANSITION_EVIDENCE_TYPE[s.transition] || "graded"} evidence (kind=${s.kind}, reducer-graded)`);
  const days = (captured.days || []).map((d) => d.day);
  return {
    visible_outputs: {
      assistant_messages: [...assistantMessages, ...cardTexts],
      structured_cards: cards,
      proof_target: landed.length ? `${landed.length} reducer-graded attempt evidence record(s) across days ${days.join(",")} (execution-grade on Day 1; NOT confirmed strong customer outcome)` : "",
    },
    sidecar_events: ["office_hours_start", "office_hours_pending_input", "submit_user_input", ...(landed.length ? ["office_hours_attempt_evidence"] : [])],
    accumulated_evidence: evidenceLines,
    attempt_evidence: { landed: landed.length, skipped: skipped.length, transitions: landed.map((s) => s.transition) },
    notes: `Office Hours locked get_users cards across days [${days.join(", ")}] for user project "${captured.label}". hasGoal=${captured.hasGoal} hasProjectContext=${captured.hasProjectContext}. ${landed.length ? `Reducer-graded attempt evidence landed: ${evidenceLines.join("; ")}. Day-1 attempt evidence is EXECUTION-grade (the action was taken), NOT confirmed customer outcome — do not score it as strong proof.` : "No reducer-graded attempt evidence landed this run."} Day outcomes: ${(captured.days || []).map((d) => `day${d.day}:${d.outcome}`).join(", ")}`,
  };
}

function buildScenario(captured) {
  return {
    repo_stage: captured.hasProjectContext ? "strategy_seeded" : "partial_setup",
    intent_mode: "startup",
    title: `Day-1 locked get_users office-hours for ${captured.label}`,
    goal: "Day-1 get_users 인터뷰 카드가 이 사용자 프로젝트의 맥락에 맞게 적응하고, ICP에게 가치 있는 하나의 구체적 검증 결정을 강제한다.",
    prompt: `사용자 프로젝트 "${captured.label}"로 Agentic30 Day-1 get_users office-hours를 진행한다. 카드(질문+선택지)가 프로젝트 맥락에 adaptive한지, ICP에 가치를 주는지 평가하라.`,
    expected_visible_outcome: { requires_proof_target: false, kind: "structured_cards" },
  };
}

export async function judgeCapture({ capturedPath, referenceDocs }) {
  const captured = JSON.parse(await fs.readFile(capturedPath, "utf8"));
  const observed = buildObservedFromCapture(captured);
  const scenario = buildScenario(captured);
  const verdict = await judgeDogfoodRun({
    scenario,
    referenceDocs,
    observed,
    workspaceRoot: packageRoot,
    timeoutMs: 180_000,
  });
  return { label: captured.label, capturedPath, cardCount: observed.visible_outputs.structured_cards.length, verdict };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  let capturedPath = null; let label = null; let outPath = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--captured") capturedPath = argv[++i];
    else if (argv[i] === "--label") label = argv[++i];
    else if (argv[i] === "--out") outPath = argv[++i];
  }
  if (!capturedPath) { console.error("usage: judge-real-arc.mjs --captured <captured.json> [--out scores.json]"); process.exit(2); }
  const referenceDocs = await loadReferenceDocs(packageRoot);
  const result = await judgeCapture({ capturedPath, referenceDocs });
  const v = result.verdict;
  const line = SCORE_KEYS.map((k) => `${k}=${v.scores?.[k] ?? "?"}`).join(" ");
  console.log(`[${result.label || label}] cards=${result.cardCount} overall=${v.overall ?? "?"} | ${line}`);
  console.log(`summary: ${v.judge_summary || v.judge_status}`);
  if (v.regressions?.length) console.log(`regressions:\n- ${v.regressions.join("\n- ")}`);
  if (outPath) { await fs.writeFile(outPath, JSON.stringify(result, null, 2) + "\n"); console.log(`scores → ${outPath}`); }
}

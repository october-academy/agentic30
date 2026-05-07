#!/usr/bin/env node
/**
 * Sub-AC 4 (AC 1.4) — manual verification CLI for Foundation Day 0–7 first
 * prompts.
 *
 * Renders every Day's first prompt the way the Mac chat surface will display
 * it (the canonical "어제: …\n오늘: …\nQ: …" 3-section minimal layout) so a
 * human reviewer can eyeball:
 *   • YC partner tone (직설 + 압박, 반말 ~어/야) — no fluff, no 정서 sugar.
 *   • 3-section minimal template — exactly Yesterday / Today / Q, 1 line each.
 *   • Day → sub_workflow / spec_version mapping (the audible right column).
 *   • Dynamic-variable substitution vs the "(아직 데이터 없음)" fallback —
 *     pass `--with-vars` to see the substituted form, omit it to confirm
 *     missing-data placeholders surface (KR4.1/4.2 evidence integrity).
 *
 * This is the manual companion to the automated WebSocket integration test
 * `sidecar-tests/foundation-first-prompt-integration.test.mjs`. The two
 * deliberately overlap in coverage — one for CI gating, one for the creator
 * to read at a glance during dogfood.
 *
 * Usage:
 *   node scripts/verify-foundation-first-prompts.mjs            # missing-vars view
 *   node scripts/verify-foundation-first-prompts.mjs --with-vars  # substituted view
 *   node scripts/verify-foundation-first-prompts.mjs --json       # machine-readable
 *   node scripts/verify-foundation-first-prompts.mjs --day=3      # single day
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FOUNDATION_DAYS,
  buildFirstPromptForDay,
} from "../sidecar/foundation-chat.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sample dynamic variables that exercise every placeholder across Day 0..7.
// Values are intentionally distinct + non-round so substitution is obvious
// in the rendered output.
const SAMPLE_DYNAMIC_VARIABLES = Object.freeze({
  runway: "6주",
  past_failures: "2건",
  weak_hypothesis_id: "H-1",
  validated_or_refuted: "강화됐어",
  n_quotes: 7,
  weak_section: "오퍼",
  reason: "가격 미정",
  impressions: 4200,
  clicks: 86,
  signups: 4,
  signal_strength: "약함",
  strong_section: "통증",
  weak_section_v3: "monetization",
});

function parseArgs(argv) {
  const args = {
    withVars: false,
    json: false,
    day: null,
    help: false,
  };
  for (const raw of argv.slice(2)) {
    if (raw === "--with-vars") args.withVars = true;
    else if (raw === "--json") args.json = true;
    else if (raw === "--help" || raw === "-h") args.help = true;
    else if (raw.startsWith("--day=")) {
      const n = Number(raw.slice("--day=".length));
      if (Number.isFinite(n) && n >= 0 && n <= 7) {
        args.day = Math.trunc(n);
      } else {
        process.stderr.write(`Invalid --day value (must be 0..7): ${raw}\n`);
        process.exit(2);
      }
    } else {
      process.stderr.write(`Unknown argument: ${raw}\n`);
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Foundation Day 0-7 first-prompt manual verification",
      "",
      "Usage:",
      "  node scripts/verify-foundation-first-prompts.mjs [options]",
      "",
      "Options:",
      "  --with-vars      Render with sample dynamic variables substituted",
      "                   (otherwise the (아직 데이터 없음) placeholder shows).",
      "  --day=N          Render only Day N (0..7). Default: all 8 days.",
      "  --json           Emit machine-readable JSON (one prompt per line key).",
      "  -h, --help       Show this help.",
      "",
      "Reviewer checklist (per day):",
      "  [ ] Tone: YC 파트너 / 시니어 메이커 (직설 + 압박, 반말 ~어/야)",
      "  [ ] No 정서 sugar: 괜찮아 / 잘하고 있어 / 응원 / 화이팅 / 힘내 등 0건",
      "  [ ] No 문어체: ~습니다 / ~입니다 / ~해요 / ~예요 / ~에요 0건",
      "  [ ] Layout: 어제 1줄 / 오늘 1줄 / Q 1줄 (정확히 3줄)",
      "  [ ] sub_workflow / spec_version mapping correct",
      "  [ ] Without --with-vars: 모든 {var} 자리에 (아직 데이터 없음) 표기",
      "",
    ].join("\n"),
  );
}

function buildAllPrompts(args) {
  const days = args.day === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [args.day];
  const dynamicVariables = args.withVars ? { ...SAMPLE_DYNAMIC_VARIABLES } : {};
  const prompts = [];
  for (const day of days) {
    const built = buildFirstPromptForDay({ day, dynamicVariables });
    if (!built) {
      throw new Error(`buildFirstPromptForDay returned null for day=${day}`);
    }
    prompts.push(built);
  }
  return prompts;
}

function emitJson(prompts) {
  // Deterministic shape — lets the script double as a source of truth for
  // any downstream tooling (e.g. a docs generator that lists each Day's
  // sample opener).
  process.stdout.write(`${JSON.stringify(prompts, null, 2)}\n`);
}

function emitHumanReport(prompts, args) {
  const headerVarMode = args.withVars
    ? "변수 치환됨 (샘플 데이터)"
    : "변수 미치환 — (아직 데이터 없음) 폴백 확인";
  const lines = [];
  lines.push(`Foundation Day 0-7 first-prompt 수동 검증`);
  lines.push(`모드: ${headerVarMode}`);
  lines.push(`Persona: ${prompts[0]?.persona ?? "(unknown)"}`);
  lines.push("─".repeat(72));

  for (const fp of prompts) {
    const descriptor = FOUNDATION_DAYS[fp.day];
    lines.push("");
    lines.push(`╭─ Day ${fp.day} ` + "─".repeat(60));
    lines.push(`│ core_question : ${descriptor.core_question}`);
    lines.push(`│ sub_workflow  : ${fp.sub_workflow ?? "(none)"}`);
    lines.push(`│ spec_version  : ${fp.spec_version ?? "(none)"}`);
    lines.push(`│ artifacts     : ${(fp.artifacts || []).join(", ") || "(none)"}`);
    lines.push(`│ input_sources : ${(descriptor.input_sources || []).join(", ")}`);
    lines.push("│");
    // Render exactly the way the chat surface displays it.
    for (const line of fp.text.split("\n")) {
      lines.push(`│ ${line}`);
    }
    lines.push("╰" + "─".repeat(70));
  }
  lines.push("");
  lines.push("─".repeat(72));
  lines.push("Reviewer checklist:");
  lines.push("  [ ] 8개 Day 모두 위에 표시됐어 (Day 0..7)");
  lines.push("  [ ] 각 Day 정확히 3줄 (어제 / 오늘 / Q)");
  lines.push("  [ ] 정서 sugar 0건 — 괜찮아 / 잘하고 있어 / 응원 / 화이팅 / 힘내");
  lines.push("  [ ] 문어체/존대 어미 0건 — ~습니다 / ~입니다 / ~해요 / ~예요 / ~에요");
  lines.push("  [ ] 반말 어미 살아 있어 — ~어 / ~야 / ~해 / ~거야 / ~건데");
  if (!args.withVars) {
    lines.push("  [ ] 변수 자리에 (아직 데이터 없음) 표기 — AI 가 값 invent 하지 않음");
  } else {
    lines.push("  [ ] 샘플 변수 (runway 6주, past_failures 2건, etc.) 정확히 치환");
  }
  lines.push("");
  process.stdout.write(`${lines.join("\n")}\n`);
}

const args = parseArgs(process.argv);
if (args.help) {
  printHelp();
  process.exit(0);
}

let prompts;
try {
  prompts = buildAllPrompts(args);
} catch (error) {
  process.stderr.write(`Failed to build prompts: ${error?.message || error}\n`);
  process.exit(1);
}

if (args.json) {
  emitJson(prompts);
} else {
  emitHumanReport(prompts, args);
}

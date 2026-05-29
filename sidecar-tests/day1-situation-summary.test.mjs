import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DAY1_SITUATION_SUMMARY_SCHEMA_VERSION,
  Day1SituationSummarySchema,
  generateDay1SituationSummary,
  buildDay1SituationSummary,
  composeDay1SituationSummary,
} from "../sidecar/generate-day1-situation-summary.mjs";
import { validateInlineDecision } from "../sidecar/inline-decision.mjs";

const NOW = new Date("2026-05-29T10:00:00Z");

const hypothesis = {
  productName: "Agentic30",
  projectKind: "mac_app",
  targetUser: "전업 1인 개발자",
  purpose: "30일 안에 첫 매출 검증을 돕는다",
  goal: "사용자 100명과 첫 매출",
  stage: "pre_revenue",
  confidence: "high",
};

const agentHistory = {
  providers: ["claude", "codex"],
  sessionCount: 5,
  lastActivityAt: "2026-05-29T08:00:00.000Z",
  recentIntents: [
    { kstDay: "2026-05-29", provider: "claude", text: "Day-1 상황 요약 카드 구현", ts: 3 },
    { kstDay: "2026-05-28", provider: "codex", text: "Notion 연동 마무리", ts: 2 },
  ],
  filesTouched: [
    { file: "sidecar/index.mjs", count: 12 },
    { file: "agentic30/ContentView.swift", count: 6 },
  ],
  commandThemes: [{ cmd: "npm run test:sidecar", count: 8 }],
  perDayKst: [],
  warnings: [],
};

test("generateDay1SituationSummary assembles valid multi-angle summary", () => {
  const summary = generateDay1SituationSummary({
    onboardingHypothesis: hypothesis,
    agentHistory,
    recentCommitSubjects: ["Add Notion OAuth", "Wire situation summary"],
    now: NOW,
  });

  assert.equal(summary.schemaVersion, DAY1_SITUATION_SUMMARY_SCHEMA_VERSION);
  // schema valid
  const parsed = Day1SituationSummarySchema.safeParse(summary);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));

  // three short angles, grounded
  assert.match(summary.angles.product, /Agentic30/);
  assert.match(summary.angles.product, /macOS 앱/);
  assert.match(summary.angles.engineering, /커밋|파일|핫스팟/);
  assert.match(summary.angles.recentFocus, /Day-1 상황 요약 카드 구현|Notion/);
  assert.ok(summary.angles.product.length <= 200);

  // provenance + confidence
  assert.equal(summary.provenance.usedAgentHistory, true);
  assert.deepEqual(summary.provenance.providers, ["claude", "codex"]);
  assert.ok(summary.confidence > 0.5);

  // next actions bounded
  assert.ok(summary.nextActions.length <= 3 && summary.nextActions.length >= 1);
});

test("goalDecision is a valid inline-decision with short balanced options", () => {
  const summary = generateDay1SituationSummary({ onboardingHypothesis: hypothesis, now: NOW });
  const validated = validateInlineDecision(summary.goalDecision);
  assert.ok(validated, "goalDecision must pass validateInlineDecision");
  assert.ok(validated.options.length >= 2);
  for (const opt of validated.options) {
    assert.ok(opt.label.length <= 30, `option label short: ${opt.label}`);
  }
  assert.equal(validated.allowFreeText, true);
});

test("generateDay1SituationSummary degrades gracefully with no signals", () => {
  const summary = generateDay1SituationSummary({ onboardingHypothesis: {}, now: NOW });
  const parsed = Day1SituationSummarySchema.safeParse(summary);
  assert.ok(parsed.success);
  assert.equal(summary.provenance.usedAgentHistory, false);
  assert.match(summary.angles.recentFocus, /신호가 부족/);
  assert.match(summary.angles.product, /이 프로젝트/);
});

test("buildDay1SituationSummary reads README + commits and detects drift", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-summary-"));
  try {
    await fs.writeFile(path.join(root, "README.md"), "# Agentic30\nA simple todo app.\n");
    const summary = await buildDay1SituationSummary({
      workspaceRoot: root,
      onboardingHypothesis: hypothesis,
      agentHistory,
      now: NOW,
      gitSubjectsImpl: async () => ["Add Notion OAuth integration", "Wire Notion sync"],
    });
    assert.ok(summary.readmeUpdate.hasDrift, "notion work absent from README → drift");
    assert.ok(summary.readmeUpdate.missing.includes("notion"));
    assert.equal(summary.provenance.readmePresent, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("composeDay1SituationSummary falls back to deterministic without queryImpl", async () => {
  const deterministic = generateDay1SituationSummary({ onboardingHypothesis: hypothesis, now: NOW });
  const composed = await composeDay1SituationSummary({ deterministic });
  assert.equal(composed.source, "deterministic");
  assert.deepEqual(composed.angles, deterministic.angles);
});

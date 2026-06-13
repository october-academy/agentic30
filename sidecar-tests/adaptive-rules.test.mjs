import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ADAPTIVE_RULE_FALSE_POSITIVE_LABEL,
  MVP_ADAPTIVE_RULE_IDS,
  evaluateAdaptiveRules,
  labelAdaptiveRuleEvent,
  recordFiredAdaptiveRules,
} from "../sidecar/adaptive-rules.mjs";
import { loadGateLedger } from "../sidecar/program-gate-engine.mjs";

const T0 = new Date("2026-06-12T09:00:00.000Z");

test("each MVP rule fires on its spec condition and stays silent below threshold", () => {
  const allFired = evaluateAdaptiveRules({
    signals: {
      buildWithoutCustomerEvidenceDays: 2,
      weekNumber: 2,
      weeklyInterviewStrongCount: 1,
      maxActionCarryOverCount: 3,
      weakOnlyEvidenceDays: 2,
      deployVerifiedUrlExists: true,
      cloudflareVisitsZeroDays: 3,
      paymentIntentCount: 2,
      paymentRecordCount: 0,
      paymentFailureCount: 0,
      abandonedThreadCount: 1,
      newCommitmentsSinceAbandoned: 2,
      daysSinceDayProgressUpdate: 3,
      appActive: true,
    },
    sources: { cloudflareAvailable: true },
    now: T0,
  });
  assert.deepEqual(allFired.firedRuleIds, [...MVP_ADAPTIVE_RULE_IDS]);
  for (const rule of allFired.fired) {
    // 오탐 대응 ①: every firing carries its source signals for dispute.
    assert.ok(Object.keys(rule.signals).length > 0, `${rule.ruleId} must attach signals`);
    assert.ok(rule.userMessage.length > 0);
    assert.ok(rule.nextAction.length > 0);
  }

  const quiet = evaluateAdaptiveRules({
    signals: {
      buildWithoutCustomerEvidenceDays: 1,
      weekNumber: 4,
      weeklyInterviewStrongCount: 2,
      maxActionCarryOverCount: 2,
      weakOnlyEvidenceDays: 1,
      deployVerifiedUrlExists: true,
      cloudflareVisitsZeroDays: 2,
      paymentIntentCount: 1,
      paymentRecordCount: 1,
      paymentFailureCount: 1,
      abandonedThreadCount: 0,
      newCommitmentsSinceAbandoned: 3,
      daysSinceDayProgressUpdate: 3,
      appActive: false,
    },
    sources: { cloudflareAvailable: true },
    now: T0,
  });
  assert.deepEqual(quiet.firedRuleIds, []);
});

test("missing signals never fire rules and AR-08 is gated on source availability", () => {
  const empty = evaluateAdaptiveRules({ signals: {}, sources: {}, now: T0 });
  assert.deepEqual(empty.firedRuleIds, []);

  const sourceDown = evaluateAdaptiveRules({
    signals: { deployVerifiedUrlExists: true, cloudflareVisitsZeroDays: 5 },
    sources: { cloudflareAvailable: false },
    now: T0,
  });
  assert.deepEqual(sourceDown.firedRuleIds, []);

  const sourceUnknown = evaluateAdaptiveRules({
    signals: { deployVerifiedUrlExists: true, cloudflareVisitsZeroDays: 5 },
    sources: {},
    now: T0,
  });
  assert.deepEqual(sourceUnknown.firedRuleIds, []);
});

test("escalation thresholds follow the spec table", () => {
  const ar01 = evaluateAdaptiveRules({
    signals: { buildWithoutCustomerEvidenceDays: 3 },
    now: T0,
  }).fired[0];
  assert.equal(ar01.ohEscalation, "immediate");

  const ar02Half = evaluateAdaptiveRules({
    signals: { weekNumber: 1, weeklyInterviewStrongCount: 1 },
    now: T0,
  }).fired[0];
  assert.equal(ar02Half.ohEscalation, "scheduled");

  const ar02Near = evaluateAdaptiveRules({
    signals: { weekNumber: 1, weeklyInterviewStrongCount: 2 },
    now: T0,
  }).fired[0];
  assert.equal(ar02Near.ohEscalation, "none");

  const ar17 = evaluateAdaptiveRules({
    signals: { abandonedThreadCount: 1, newCommitmentsSinceAbandoned: 1 },
    now: T0,
  }).fired[0];
  assert.equal(ar17.progression, "block_new_commitments");
  assert.equal(ar17.ohEscalation, "immediate");

  const ar19Late = evaluateAdaptiveRules({
    signals: { daysSinceDayProgressUpdate: 5, appActive: true },
    now: T0,
  }).fired[0];
  assert.equal(ar19Late.ohEscalation, "scheduled");
});

test("false-positive label persists to the gate ledger and imposes a 48h cooldown", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-adaptive-rules-"));
  const evaluation = evaluateAdaptiveRules({
    signals: { buildWithoutCustomerEvidenceDays: 2 },
    now: T0,
  });
  await recordFiredAdaptiveRules({ workspaceRoot: root, fired: evaluation.fired, now: T0 });

  const { labeled } = await labelAdaptiveRuleEvent({
    workspaceRoot: root,
    ruleId: "AR-01",
    label: ADAPTIVE_RULE_FALSE_POSITIVE_LABEL,
    now: T0,
  });
  assert.equal(labeled.userLabel, ADAPTIVE_RULE_FALSE_POSITIVE_LABEL);

  const ledger = await loadGateLedger({ workspaceRoot: root });
  assert.equal(ledger.adaptiveEvents.at(-1).userLabel, ADAPTIVE_RULE_FALSE_POSITIVE_LABEL);

  // 47h later: still cooled down.
  const cooled = evaluateAdaptiveRules({
    signals: { buildWithoutCustomerEvidenceDays: 4 },
    recentAdaptiveEvents: ledger.adaptiveEvents,
    now: new Date("2026-06-14T08:00:00.000Z"),
  });
  assert.deepEqual(cooled.firedRuleIds, []);

  // 49h later: cooldown expired, the rule may fire again.
  const resumed = evaluateAdaptiveRules({
    signals: { buildWithoutCustomerEvidenceDays: 4 },
    recentAdaptiveEvents: ledger.adaptiveEvents,
    now: new Date("2026-06-14T10:00:00.000Z"),
  });
  assert.deepEqual(resumed.firedRuleIds, ["AR-01"]);
});

test("AR-17 enforcement blocks new commitments until the firing is disputed", async () => {
  const { isNewCommitmentBlockedByAr17 } = await import("../sidecar/adaptive-rules.mjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-ar17-enforce-"));
  const fired = evaluateAdaptiveRules({
    signals: { abandonedThreadCount: 1, newCommitmentsSinceAbandoned: 1 },
    now: T0,
  }).fired;
  await recordFiredAdaptiveRules({ workspaceRoot: root, fired, now: T0 });

  assert.equal(await isNewCommitmentBlockedByAr17({ workspaceRoot: root, now: T0 }), true);
  // 다음 날에는 당일 발화가 아니므로 차단하지 않는다(그날 다시 발화하면 차단).
  assert.equal(
    await isNewCommitmentBlockedByAr17({ workspaceRoot: root, now: new Date("2026-06-13T09:00:00.000Z") }),
    false,
  );

  // 오탐 라벨이 당일 차단을 해제한다 (§12 오탐대응 ②).
  await labelAdaptiveRuleEvent({ workspaceRoot: root, ruleId: "AR-17", now: T0 });
  assert.equal(await isNewCommitmentBlockedByAr17({ workspaceRoot: root, now: T0 }), false);
});

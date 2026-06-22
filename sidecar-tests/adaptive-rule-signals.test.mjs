import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assembleAdaptiveRuleSignals } from "../sidecar/adaptive-rule-signals.mjs";
import { runAdaptiveRulesCycle } from "../sidecar/adaptive-rules.mjs";
import { appendProofLedgerEvent } from "../sidecar/execution-os.mjs";
import { appendCommitment } from "../sidecar/office-hours-memory.mjs";
import { patchDayStep } from "../sidecar/day-progress-state.mjs";
import { loadGateLedger } from "../sidecar/program-gate-engine.mjs";

const T0 = new Date("2026-06-12T09:00:00.000Z");

async function tmpWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "agentic30-rule-signals-"));
}

test("assembler derives revenue, quota, weak-only and stall signals from persisted stores", async () => {
  const ws = await tmpWorkspace();
  try {
    for (const event of [
      // payment_intent infers strength=strong — keep them OFF days 13–14 so
      // the weak-only run is not broken by the revenue events themselves.
      { id: "ask-1", type: "payment_intent", day: 11, status: "submitted" },
      { id: "ask-2", type: "payment_intent", day: 12, status: "accepted" },
      { id: "iv-1", type: "interview", day: 9, status: "verified", strength: "strong" },
      { id: "weak-1", type: "work_log", day: 14, status: "submitted", strength: "weak" },
      { id: "weak-2", type: "work_log", day: 13, status: "submitted", strength: "weak" },
    ]) {
      await appendProofLedgerEvent({ workspaceRoot: ws, event, now: T0 });
    }
    await patchDayStep({
      workspaceRoot: ws,
      day: 14,
      stepId: "scan",
      status: "done",
      now: new Date("2026-06-08T09:00:00.000Z"),
    });

    const { signals, sources } = await assembleAdaptiveRuleSignals({
      workspaceRoot: ws,
      day: 14,
      now: T0,
    });

    assert.equal(signals.paymentIntentCount, 2);
    assert.equal(signals.paymentRecordCount, 0);
    assert.equal(signals.weekNumber, 2);
    assert.equal(signals.weeklyInterviewStrongCount, 1);
    assert.equal(signals.weakOnlyEvidenceDays, 2);
    // 6/8 patch vs 6/12 now → 4 days stalled, app observed active.
    assert.equal(signals.daysSinceDayProgressUpdate, 4);
    assert.equal(signals.appActive, true);
    // Empty work-history snapshot → AR-01 input stays null (rule silent).
    assert.equal(signals.buildWithoutCustomerEvidenceDays, null);
    // No persisted traffic source → unavailable, rule silent (§12-③).
    assert.equal(sources.cloudflareAvailable, null);
    assert.equal(signals.maxActionCarryOverCount, null);
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("assembler derives AR-05 carry-over and AR-08 zero-traffic signals from persisted stores", async () => {
  const ws = await tmpWorkspace();
  try {
    const agentic30Dir = path.join(ws, ".agentic30");
    await fs.mkdir(agentic30Dir, { recursive: true });
    await fs.writeFile(
      path.join(agentic30Dir, "curriculum-progress.json"),
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: T0.toISOString(),
        carryOverQueue: [
          {
            actionId: "send-pricing-ask",
            sourceDay: 11,
            targetDay: 14,
            actionDescription: "Send pricing ask to one named customer",
            timesCarried: 3,
            carryOverStatus: "active",
          },
        ],
      }),
      "utf8",
    );

    for (const day of [12, 13, 14]) {
      await appendProofLedgerEvent({
        workspaceRoot: ws,
        event: {
          id: `traffic-${day}`,
          type: "traffic_snapshot",
          day,
          status: "verified",
          sourceUrl: "https://example.com",
          metadata: {
            provider: "cloudflare",
            counts: { visits: 0, pageviews: 8 },
          },
        },
        now: T0,
      });
    }

    const { signals, sources } = await assembleAdaptiveRuleSignals({
      workspaceRoot: ws,
      day: 14,
      now: T0,
    });

    assert.equal(signals.maxActionCarryOverCount, 3);
    assert.equal(sources.cloudflareAvailable, true);
    assert.equal(signals.deployVerifiedUrlExists, true);
    assert.equal(signals.cloudflareVisitsZeroDays, 3);
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("assembler counts abandoned commitments and promises stacked on top of them", async () => {
  const ws = await tmpWorkspace();
  try {
    await appendCommitment({
      workspaceRoot: ws,
      text: "조은성에게 DM으로 가격 제안 보내기",
      cycle: 5,
      day: 5,
      originText: "조은성에게 DM으로 가격 제안 보내기",
    });
    await appendCommitment({
      workspaceRoot: ws,
      text: "후속 후보 2명에게 데모 링크 보내기",
      cycle: 8,
      day: 8,
      originText: "후속 후보 2명에게 데모 링크 보내기",
    });

    const { signals } = await assembleAdaptiveRuleSignals({
      workspaceRoot: ws,
      day: 8,
      now: T0,
    });
    assert.equal(signals.abandonedThreadCount, 1);
    assert.equal(signals.newCommitmentsSinceAbandoned, 1);
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("runAdaptiveRulesCycle records fresh firings once per day with attached signals", async () => {
  const ws = await tmpWorkspace();
  try {
    const assemble = async () => ({
      signals: { paymentIntentCount: 2, paymentRecordCount: 0, paymentFailureCount: 0 },
      sources: {},
    });

    const first = await runAdaptiveRulesCycle({ workspaceRoot: ws, day: 14, now: T0, assemble });
    assert.deepEqual(first.fired.map((rule) => rule.ruleId), ["AR-14"]);
    assert.equal(first.recorded.length, 1);
    assert.equal(first.recorded[0].signals.paymentIntentCount, 2);

    // Same day re-evaluation: already recorded → nothing fresh.
    const second = await runAdaptiveRulesCycle({
      workspaceRoot: ws,
      day: 14,
      now: new Date("2026-06-12T20:00:00.000Z"),
      assemble,
    });
    assert.deepEqual(second.fired, []);
    assert.equal(second.recorded.length, 0);

    // Next day: fires again.
    const third = await runAdaptiveRulesCycle({
      workspaceRoot: ws,
      day: 15,
      now: new Date("2026-06-13T09:00:00.000Z"),
      assemble,
    });
    assert.deepEqual(third.fired.map((rule) => rule.ruleId), ["AR-14"]);

    const ledger = await loadGateLedger({ workspaceRoot: ws });
    assert.equal(ledger.adaptiveEvents.length, 2);
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
});

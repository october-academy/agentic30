import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  appendProofLedgerEvent,
  buildDailyMissionCard,
  buildProofPrerequisiteRequirements,
  captureExecutionOsTelemetryEvents,
  composeExecutionOsSnapshot,
  computeExecutionOsMetrics,
  evaluateFoundationClosure,
  evaluatePilotReadiness,
  loadProofLedger,
  resolveProofLedgerPath,
} from "../sidecar/execution-os.mjs";

test("appendProofLedgerEvent persists sanitized proof events", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-proof-ledger-"));

  const result = await appendProofLedgerEvent({
    workspaceRoot: root,
    now: new Date("2026-06-08T01:00:00.000Z"),
    event: {
      id: "dm-proof-1",
      type: "dm_ask",
      day: 6,
      status: "accepted",
      strength: "strong",
      customer: "solo founder",
      sourceUrl: "https://example.com/proof?token=secret-token",
      // Token split across string literals so the public-safety scanner does
      // not flag this redaction fixture as a real openai-token (same runtime value).
      summary: "asked for $29, api key " + "sk" + "-abcdefghijklmnopqrstuvwxyz123456",
      metadata: {
        authorization: "Bearer secret",
        askKind: "money",
      },
    },
  });

  assert.equal(result.event.id, "dm-proof-1");
  assert.equal(result.event.type, "dm_ask");
  assert.equal(result.event.status, "accepted");
  assert.equal(result.event.metadata.authorization, "[redacted]");
  assert.match(result.event.summary, /\[redacted\]/);
  assert.match(result.event.sourceUrl, /token=%5Bredacted%5D/);

  const loaded = await loadProofLedger({ workspaceRoot: root });
  assert.equal(loaded.events.length, 1);
  assert.equal(loaded.events[0].id, "dm-proof-1");
  assert.equal(resolveProofLedgerPath(root), path.join(root, ".agentic30", "proof-ledger.json"));
});

test("buildDailyMissionCard creates a provider-free mission-first surface", () => {
  const card = buildDailyMissionCard({
    day: 6,
    now: new Date("2026-06-08T01:00:00.000Z"),
    day1GoalSelection: {
      customer: "pre-revenue solo macOS developers",
      problem: "generic agents do not force customer proof",
      validationAction: "Send a DM asking whether they will pay $29 or commit one hour this week.",
      evidenceRefs: ["docs/ICP.md", "docs/VALUES.md"],
    },
    proofLedger: {
      events: [
        {
          id: "interview-1",
          type: "interview",
          day: 3,
          status: "accepted",
          createdAt: "2026-06-07T01:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(card.componentType, "execution_os_daily_mission_card");
  assert.equal(card.uiPlacement, "above_chat_primary");
  assert.equal(card.providerRequired, false);
  assert.equal(card.localFallbackAvailable, true);
  assert.equal(card.cardRole, "primary_execution_surface");
  assert.equal(card.targetCustomer, "pre-revenue solo macOS developers");
  assert.match(card.actionText, /pay \$29|commit one hour/);
  assert.equal(card.evidenceType, "link");
  assert.ok(card.deadlineAt);
  assert.ok(card.completionSignal);
  assert.ok(card.failureMiniAction);
  assert.deepEqual(card.agentBridge.providers, ["claude", "codex", "cursor"]);
  assert.equal(card.agentBridge.primarySurface, false);
  assert.equal(card.sourceEvidenceRefs.includes("docs/ICP.md"), true);
  assert.equal(card.sourceEvidenceRefs.includes("interview-1"), true);
});

test("composeExecutionOsSnapshot blocks next-day unlock until prior proof is accepted", () => {
  const blocked = composeExecutionOsSnapshot({
    workspaceRoot: "/tmp/product",
    day: 3,
    now: new Date("2026-06-08T01:00:00.000Z"),
    proofLedger: {
      events: [
        {
          id: "day-1-proof",
          type: "action_evidence",
          day: 1,
          status: "accepted",
          createdAt: "2026-06-06T01:00:00.000Z",
        },
        {
          id: "day-2-proof",
          type: "action_evidence",
          day: 2,
          status: "submitted",
          createdAt: "2026-06-07T01:00:00.000Z",
        },
      ],
    },
    diagnostics: { redactionSafe: true },
    preflight: { status: "ok", checks: [] },
  });

  assert.equal(blocked.submitJudgeUnlock.submit.module, "action-day-evidence-submission.mjs");
  assert.equal(blocked.submitJudgeUnlock.judge.module, "action-evidence-judge.mjs");
  assert.equal(blocked.submitJudgeUnlock.unlock.module, "curriculum-progression-gate.mjs");
  assert.equal(blocked.progressionGate.blocked, true);
  assert.deepEqual(blocked.progressionGate.blockingRequirementIds, ["proof-ledger-day-2-accepted"]);

  const allowed = composeExecutionOsSnapshot({
    workspaceRoot: "/tmp/product",
    day: 3,
    now: new Date("2026-06-08T01:00:00.000Z"),
    proofLedger: {
      events: [
        { id: "day-1-proof", type: "action_evidence", day: 1, status: "accepted" },
        { id: "day-2-proof", type: "action_evidence", day: 2, status: "verified" },
      ],
    },
    diagnostics: { redactionSafe: true },
    preflight: { status: "ok", checks: [] },
  });

  assert.equal(allowed.progressionGate.allowed, true);
});

test("foundation closure requires Day 7 decision plus supporting and counter evidence", () => {
  const pending = evaluateFoundationClosure({
    currentDay: 7,
    proofLedger: {
      events: [
        {
          id: "supporting-1",
          type: "payment_intent",
          day: 6,
          status: "accepted",
          strength: "strong",
          polarity: "supporting",
        },
        {
          id: "decision-1",
          type: "day_decision",
          day: 7,
          status: "accepted",
          decision: "continue",
        },
      ],
    },
  });

  assert.equal(pending.day7DecisionCompleted, true);
  assert.equal(pending.goNoGoReady, false);
  assert.equal(pending.status, "decision_needs_supporting_and_counter_evidence");

  const closed = evaluateFoundationClosure({
    currentDay: 7,
    proofLedger: {
      events: [
        {
          id: "supporting-1",
          type: "payment_intent",
          day: 6,
          status: "accepted",
          strength: "strong",
          polarity: "supporting",
        },
        {
          id: "counter-1",
          type: "interview",
          day: 5,
          status: "verified",
          strength: "medium",
          polarity: "counter",
        },
        {
          id: "decision-1",
          type: "day_decision",
          day: 7,
          status: "accepted",
          decision: "pivot",
        },
      ],
    },
  });

  assert.equal(closed.goNoGoReady, true);
  assert.equal(closed.status, "closed");
  assert.equal(closed.decision, "pivot");
});

test("metrics and readiness cover P1/P2 pilot signals", () => {
  const metrics = computeExecutionOsMetrics({
    proofLedger: {
      events: [
        { id: "setup", type: "setup", status: "accepted", createdAt: "2026-06-08T00:00:00.000Z" },
        { id: "mission", type: "mission", status: "accepted", createdAt: "2026-06-08T00:04:00.000Z" },
        { id: "e1", type: "interview", day: 1, status: "submitted", createdAt: "2026-06-08T00:08:00.000Z" },
        { id: "e3", type: "work_log", day: 3, status: "accepted", createdAt: "2026-06-10T00:08:00.000Z" },
        { id: "ask", type: "dm_ask", day: 6, status: "accepted", metadata: { askKind: "time" } },
        { id: "ref", type: "referral", day: 6, status: "accepted" },
        { id: "decision", type: "day_decision", day: 7, status: "verified", decision: "continue" },
      ],
    },
    routeTimings: [
      { route: "instant_chat", elapsedMs: 250 },
      { route: "generic", elapsedMs: 1000 },
      { route: "agentic", elapsedMs: 5000 },
    ],
  });

  assert.equal(metrics.setupSuccess, true);
  assert.equal(metrics.timeToFirstMissionMs, 240000);
  assert.equal(metrics.firstEvidenceSubmitted, true);
  assert.equal(metrics.day3Retained, true);
  assert.equal(metrics.day7DecisionCompleted, true);
  assert.equal(metrics.moneyOrTimeAskSent, true);
  assert.equal(metrics.referralSignal, true);
  assert.equal(metrics.genericAnswerRate, 0.333);
  assert.equal(metrics.routeLatencyP50Ms, 1000);
  assert.equal(metrics.routeLatencyP95Ms, 5000);

  const blocked = evaluatePilotReadiness({
    diagnostics: { redactionSafe: true },
    preflight: {
      status: "ok",
      checks: [
        {
          id: "provider-auth",
          status: "warning",
          recovery: "Sign in with a provider.",
        },
      ],
    },
    releaseState: { signed: true, notarized: false, updaterConfigured: false },
    telemetryState: { configured: false, optOutAvailable: true },
    crashState: { nativeCrashReportingAvailable: false },
    now: new Date("2026-06-08T01:00:00.000Z"),
  });

  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.publicPilotReady, false);
  assert.equal(blocked.privatePilotReady, true);
  assert.deepEqual(
    blocked.blockers.map((blocker) => blocker.id),
    ["notarized-installer", "updater-configured", "native-crash-reporting"],
  );

  const ready = evaluatePilotReadiness({
    diagnostics: { redactionSafe: true },
    preflight: {
      status: "ok",
      checks: [{ id: "provider-auth", status: "ok" }],
    },
    releaseState: { signed: true, notarized: true, updaterConfigured: true },
    telemetryState: { optOutAvailable: true },
    crashState: { nativeCrashReportingAvailable: true },
  });

  assert.equal(ready.status, "ready");
  assert.equal(ready.publicPilotReady, true);
});

test("telemetry helper emits milestone events once against previous metrics", () => {
  const events = [];
  const telemetry = {
    captureEvent(name, properties) {
      events.push({ name, properties });
    },
  };
  const snapshot = composeExecutionOsSnapshot({
    workspaceRoot: "/tmp/product",
    day: 8,
    proofLedger: {
      events: [
        { id: "d1", type: "action_evidence", day: 1, status: "accepted" },
        { id: "d2", type: "action_evidence", day: 2, status: "accepted" },
        { id: "d3", type: "work_log", day: 3, status: "accepted" },
        { id: "d4", type: "landing_metric", day: 4, status: "accepted" },
        { id: "d5", type: "interview", day: 5, status: "accepted", polarity: "counter", strength: "medium" },
        { id: "d6", type: "dm_ask", day: 6, status: "accepted", polarity: "supporting", strength: "strong" },
        { id: "d7", type: "day_decision", day: 7, status: "accepted", decision: "continue" },
      ],
    },
    diagnostics: { redactionSafe: true },
    preflight: { status: "ok", checks: [] },
  });

  const emitted = captureExecutionOsTelemetryEvents(telemetry, snapshot, {
    previousMetrics: {
      firstMissionReady: true,
      firstEvidenceSubmitted: true,
    },
  });

  assert.equal(emitted.includes("mac_sidecar_execution_os_day7_decision_completed"), true);
  assert.equal(emitted.includes("mac_sidecar_execution_os_money_time_ask_sent"), true);
  assert.equal(emitted.includes("mac_sidecar_execution_os_readiness_checked"), true);
  assert.equal(events.every((event) => event.properties.current_day === 8), true);
});

test("proof ledger v1 documents migrate to v2 with events passing through unchanged", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-proof-ledger-v1-"));
  const ledgerPath = resolveProofLedgerPath(root);
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  const v1Events = [
    { id: "v1-setup", type: "setup", status: "accepted", createdAt: "2026-06-01T00:00:00.000Z" },
    { id: "v1-interview", type: "interview", day: 1, status: "accepted", strength: "medium", createdAt: "2026-06-01T01:00:00.000Z" },
    { id: "v1-dm", type: "dm_ask", day: 6, status: "accepted", strength: "strong", createdAt: "2026-06-06T01:00:00.000Z" },
    { id: "v1-decision", type: "day_decision", day: 7, status: "verified", decision: "continue", createdAt: "2026-06-07T01:00:00.000Z" },
  ];
  await fs.writeFile(ledgerPath, JSON.stringify({
    schemaVersion: 1,
    schema_version: 1,
    schema: "agentic30.proof_ledger.v1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-07T01:00:00.000Z",
    events: v1Events,
  }));

  const loaded = await loadProofLedger({ workspaceRoot: root });

  assert.equal(loaded.schemaVersion, 2);
  assert.equal(loaded.schema, "agentic30.proof_ledger.v2");
  assert.equal(loaded.events.length, v1Events.length);
  for (const [index, original] of v1Events.entries()) {
    assert.equal(loaded.events[index].id, original.id);
    assert.equal(loaded.events[index].type, original.type);
    assert.equal(loaded.events[index].status, original.status);
    assert.equal(loaded.events[index].createdAt, original.createdAt);
  }
  assert.equal(loaded.events[1].strength, "medium");
  assert.equal(loaded.events[2].strength, "strong");
  assert.equal(loaded.events[3].decision, "continue");
});

test("proof ledger v2 accepts revenue and traffic event types", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-proof-ledger-v2-"));

  const record = await appendProofLedgerEvent({
    workspaceRoot: root,
    now: new Date("2026-06-08T01:00:00.000Z"),
    event: { id: "pay-1", type: "payment_record", day: 14, status: "accepted" },
  });
  assert.equal(record.event.type, "payment_record");
  assert.equal(record.event.strength, "strong");

  const failure = await appendProofLedgerEvent({
    workspaceRoot: root,
    now: new Date("2026-06-08T01:05:00.000Z"),
    event: { id: "fail-1", type: "payment_failure", day: 14, status: "submitted" },
  });
  assert.equal(failure.event.type, "payment_failure");

  const refund = await appendProofLedgerEvent({
    workspaceRoot: root,
    now: new Date("2026-06-08T01:10:00.000Z"),
    event: { id: "refund-1", type: "refund", day: 15, status: "submitted" },
  });
  assert.equal(refund.event.type, "refund");

  const traffic = await appendProofLedgerEvent({
    workspaceRoot: root,
    now: new Date("2026-06-08T01:15:00.000Z"),
    event: { id: "traffic-1", type: "traffic_snapshot", day: 15, status: "verified" },
  });
  assert.equal(traffic.event.type, "traffic_snapshot");

  const loaded = await loadProofLedger({ workspaceRoot: root });
  assert.equal(loaded.schemaVersion, 2);
  assert.deepEqual(
    loaded.events.map((event) => event.type),
    ["payment_record", "payment_failure", "refund", "traffic_snapshot"],
  );
});

test("traffic_snapshot events do not satisfy per-day proof prerequisites", () => {
  const requirements = buildProofPrerequisiteRequirements({
    currentDay: 3,
    proofLedger: {
      events: [
        { id: "day-1-proof", type: "action_evidence", day: 1, status: "accepted" },
        { id: "day-2-traffic", type: "traffic_snapshot", day: 2, status: "verified" },
      ],
    },
  });

  const day2 = requirements.requirements.find((entry) => entry.sourceDay === 2);
  assert.equal(day2.verified, false);
  assert.equal(day2.status, "unmet");
});

test("buildProofPrerequisiteRequirements adds Day 7 decision for post-foundation unlock", () => {
  const requirements = buildProofPrerequisiteRequirements({
    currentDay: 8,
    proofLedger: {
      events: [
        { type: "action_evidence", day: 1, status: "accepted" },
        { type: "action_evidence", day: 2, status: "accepted" },
        { type: "action_evidence", day: 3, status: "accepted" },
        { type: "action_evidence", day: 4, status: "accepted" },
        { type: "action_evidence", day: 5, status: "accepted" },
        { type: "action_evidence", day: 6, status: "accepted" },
      ],
    },
  });

  assert.equal(requirements.requirements.length, 8);
  assert.equal(requirements.requirements.at(-1).requirementId, "foundation-day-7-decision");
  assert.equal(requirements.requirements.at(-1).verified, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildAutoVerificationWriteThroughEvent,
  buildJudgeWriteThroughEvent,
  classifyJudgedEvidenceStrength,
  recordActionEvidenceOutcome,
} from "../sidecar/proof-ledger-write-through.mjs";
import { completeActionEvidenceWithJudge } from "../sidecar/action-evidence-judge.mjs";
import { runActionAutoVerification } from "../sidecar/action-day-auto-verification.mjs";
import {
  ACTION_VERIFICATION_METHOD,
  createActionDayVerificationState,
  passActionVerification,
  startActionVerification,
} from "../sidecar/action-day-verification-state.mjs";
import { loadProofLedger } from "../sidecar/execution-os.mjs";

function makeClock(start = "2026-06-12T09:00:00.000Z") {
  let next = new Date(start).getTime();
  return () => {
    const value = new Date(next);
    next += 1_000;
    return value;
  };
}

function acceptedJudgeJson() {
  return JSON.stringify({
    status: "accepted",
    confidence: 0.85,
    agent_assessment: "Evidence shows the DM was sent with a timestamp.",
    criterion_results: [
      { type: "completion", label: "sent", passed: true, reason: "Send time visible." },
    ],
    missing_elements: [],
    mini_action_suggestion: "",
  });
}

test("judge accepted link evidence writes accepted/medium through to the ledger", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-wt-judge-"));
  const result = await recordActionEvidenceOutcome({
    workspaceRoot: root,
    day: 6,
    actionId: "day-6-ask",
    judgment: {
      status: "accepted",
      confidence: 0.85,
      agentAssessment: "Evidence shows the DM was sent with a timestamp.",
    },
    evidence: { type: "link", content: "https://example.com/dm-capture" },
    now: new Date("2026-06-12T09:00:00.000Z"),
  });

  assert.equal(result.event.type, "action_evidence");
  assert.equal(result.event.status, "accepted");
  assert.equal(result.event.strength, "medium");
  assert.equal(result.event.day, 6);
  assert.equal(result.event.actionId, "day-6-ask");
  assert.equal(result.event.evidenceType, "link");
  assert.equal(result.event.sourceUrl, "https://example.com/dm-capture");
  assert.equal(result.event.metadata.verifiedBy, "judge");
  assert.equal(result.event.metadata.judgeConfidence, 0.85);

  const loaded = await loadProofLedger({ workspaceRoot: root });
  assert.equal(loaded.events.length, 1);
  assert.equal(loaded.events[0].status, "accepted");
});

test("judge accepted interview transcript file is promoted to strong", () => {
  assert.equal(
    classifyJudgedEvidenceStrength({
      evidence: { type: "file", content: "/tmp/day3-interview-transcript.md" },
      guideline: { actionType: "interview_recording" },
    }),
    "strong",
  );
  assert.equal(
    classifyJudgedEvidenceStrength({
      evidence: { type: "file", content: "/tmp/notes.md" },
      guideline: { actionType: "dm_log" },
    }),
    "medium",
  );
  // User-controlled file names must not promote strength: renaming a
  // self-report file to "transcript" stays medium (fail-closed).
  assert.equal(
    classifyJudgedEvidenceStrength({
      evidence: { type: "file", content: "/tmp/interview-transcript-녹취.md" },
      guideline: { actionType: "dm_log" },
    }),
    "medium",
  );

  const event = buildJudgeWriteThroughEvent({
    day: 3,
    actionId: "day-3-interview",
    judgment: { status: "accepted", confidence: 0.9, agentAssessment: "Transcript confirms the interview." },
    evidence: { type: "file", content: "/tmp/day3-interview-recording.m4a" },
    guideline: { actionType: "interview_recording" },
    now: new Date("2026-06-12T09:00:00.000Z"),
  });
  assert.equal(event.strength, "strong");
  assert.equal(event.status, "accepted");
  assert.equal(event.artifactPath, "/tmp/day3-interview-recording.m4a");
});

test("judge insufficient writes weak/insufficient and judge error writes nothing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-wt-insufficient-"));

  const insufficient = await recordActionEvidenceOutcome({
    workspaceRoot: root,
    day: 2,
    actionId: "day-2-market",
    judgment: {
      status: "insufficient",
      confidence: 0.4,
      agentAssessment: "No pricing evidence in the log.",
      missingElements: ["pricing_evidence"],
    },
    evidence: { type: "file", content: "/tmp/day-2-evidence-log.md" },
    now: new Date("2026-06-12T09:00:00.000Z"),
  });
  assert.equal(insufficient.event.status, "insufficient");
  assert.equal(insufficient.event.strength, "weak");
  assert.deepEqual(insufficient.event.metadata.missingElements, ["pricing_evidence"]);

  const errorOutcome = await recordActionEvidenceOutcome({
    workspaceRoot: root,
    day: 2,
    actionId: "day-2-market",
    judgment: { status: "error", confidence: 0, agentAssessment: "Judge unavailable." },
    evidence: { type: "file", content: "/tmp/day-2-evidence-log.md" },
    now: new Date("2026-06-12T09:05:00.000Z"),
  });
  assert.equal(errorOutcome, null);

  const loaded = await loadProofLedger({ workspaceRoot: root });
  assert.equal(loaded.events.length, 1);
});

test("auto-verification pass writes verified/strong; failure writes nothing", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 9,
    actionId: "day-9-flow",
    actionDescription: "Publish the landing page URL.",
    completionSignal: "Verifier confirms the URL.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.mcp],
    now,
  });
  const passed = passActionVerification(
    startActionVerification(pending, { method: ACTION_VERIFICATION_METHOD.browser, now }),
    { confidence: 0.95, agentAssessment: "Page shows the expected text.", now },
  );

  const event = buildAutoVerificationWriteThroughEvent({
    verificationState: passed,
    evidence: { type: "link", content: "https://example.com/landing" },
    now: new Date("2026-06-12T09:00:00.000Z"),
  });
  assert.equal(event.status, "verified");
  assert.equal(event.strength, "strong");
  assert.equal(event.day, 9);
  assert.equal(event.actionId, "day-9-flow");
  assert.equal(event.metadata.verifiedBy, "auto");
  assert.equal(event.metadata.verificationMethod, ACTION_VERIFICATION_METHOD.browser);
  assert.equal(event.source, `auto:${ACTION_VERIFICATION_METHOD.browser}`);

  const failedEvent = buildAutoVerificationWriteThroughEvent({
    verificationState: { ...passed, status: "failed" },
    now: new Date("2026-06-12T09:00:00.000Z"),
  });
  assert.equal(failedEvent, null);
});

test("completeActionEvidenceWithJudge persists the verdict when proofLedger is provided", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-wt-complete-"));
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 6,
    actionId: "day-6-ask",
    actionDescription: "Send the money/time ask.",
    completionSignal: "Send capture with timestamp.",
    now,
  });
  const running = startActionVerification(pending, {
    method: ACTION_VERIFICATION_METHOD.manual,
    evidenceSubmission: {
      type: "link",
      content: "https://example.com/ask-capture",
      submittedAt: "2026-06-12T09:00:00.000Z",
    },
    now,
  });

  const outcome = await completeActionEvidenceWithJudge(running, {
    guideline: { dayId: 6, actionId: "day-6-ask", actionType: "dm_log" },
    runJudge: async () => acceptedJudgeJson(),
    proofLedger: { workspaceRoot: root },
    now,
  });

  assert.equal(outcome.status, "accepted");
  assert.equal(outcome.proofLedgerEvent.status, "accepted");
  assert.equal(outcome.proofLedgerEvent.strength, "medium");
  assert.equal(outcome.proofLedgerEvent.day, 6);

  const loaded = await loadProofLedger({ workspaceRoot: root });
  assert.equal(loaded.events.length, 1);
  assert.equal(loaded.events[0].actionId, "day-6-ask");

  const errorOutcome = await completeActionEvidenceWithJudge(running, {
    guideline: { dayId: 6, actionId: "day-6-ask" },
    runJudge: async () => {
      throw new Error("provider down");
    },
    proofLedger: { workspaceRoot: root },
    now,
  });
  assert.equal(errorOutcome.status, "error");
  assert.equal(errorOutcome.proofLedgerEvent, null);
  const afterError = await loadProofLedger({ workspaceRoot: root });
  assert.equal(afterError.events.length, 1);
});

test("runActionAutoVerification persists a passing result when proofLedger is provided", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-wt-auto-"));
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 12,
    actionId: "day-12-dogfood",
    actionDescription: "Run the dogfood check.",
    completionSignal: "Sheet includes the proof row.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.googleSheets],
    now,
  });

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "Sheet includes the proof row.",
      verification_method: { type: "mcp", tools: ["google_sheets"] },
    },
    configuredMcpServers: {
      agentic30_sidecar: { command: "node" },
    },
    configuredMcpTools: {
      agentic30_sidecar: ["gws_sheets_read"],
    },
    callMcpTool: async () => ({
      structuredContent: {
        passed: true,
        confidence: 0.9,
        agentAssessment: "Sheet includes the proof row.",
      },
    }),
    proofLedger: { workspaceRoot: root },
    now,
  });

  assert.equal(result.passed, true);
  assert.equal(result.proofLedgerEvent.status, "verified");
  assert.equal(result.proofLedgerEvent.strength, "strong");
  assert.equal(result.proofLedgerEvent.day, 12);
  assert.equal(result.proofLedgerEvent.actionId, "day-12-dogfood");

  const loaded = await loadProofLedger({ workspaceRoot: root });
  assert.equal(loaded.events.length, 1);
  assert.equal(loaded.events[0].metadata.verifiedBy, "auto");
});

test("runActionAutoVerification failure does not write to the ledger", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-wt-auto-fail-"));
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 12,
    actionId: "day-12-dogfood",
    actionDescription: "Run the dogfood check.",
    completionSignal: "Sheet includes the proof row.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.googleSheets],
    now,
  });

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "Sheet includes the proof row.",
      verification_method: { type: "mcp", tools: ["google_sheets"] },
    },
    configuredMcpServers: {
      agentic30_sidecar: { command: "node" },
    },
    configuredMcpTools: {
      agentic30_sidecar: ["gws_sheets_read"],
    },
    callMcpTool: async () => ({
      structuredContent: {
        passed: false,
        reason: "Proof row missing.",
      },
    }),
    proofLedger: { workspaceRoot: root },
    now,
  });

  assert.equal(result.passed, false);
  assert.equal(result.proofLedgerEvent, null);
  const loaded = await loadProofLedger({ workspaceRoot: root });
  assert.equal(loaded.events.length, 0);
});

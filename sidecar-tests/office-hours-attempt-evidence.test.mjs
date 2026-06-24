import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

import {
  startAttempt,
  commitAttemptEvent,
  projectAttempt,
  loadAttemptLog,
} from "../sidecar/office-hours-attempt-store.mjs";
import { canStartNewAttempt } from "../sidecar/office-hours-contract.mjs";

// R2 cut: the `office_hours_attempt_evidence` WS command routes the six evidence
// transitions through commitAttemptEvent (the SINGLE store writer). These tests
// spawn the real sidecar (stub provider) and exercise the handler end to end:
//   - happy path: record_action_proof advances execution_scheduled → awaiting_customer_outcome
//   - rejected-kind fail-closed: a rejected evidence kind → success:false (no soften)
//   - wrong-grade fail-closed: a customer_outcome kind in an action WAIT → success:false
//   - two-writer reject: office_hours_commitment_evidence with an attemptId → success:false
// The grading authority is the reducer; the handler must never fail-open.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ATTEMPT_ISO = "2026-06-13T00:00:00.000Z";

// Drive a fresh attempt all the way to execution_scheduled (WAIT reason "action")
// on disk via the store API, returning { attemptId, revision }.
async function seedScheduledAttempt(workspacePath, attemptId = "attempt-wait-1") {
  await startAttempt({ workspaceRoot: workspacePath, goalLane: "get_users", day: 1, attemptId, now: new Date(ATTEMPT_ISO) });
  const gather = [
    ["define_activation", { activationDefinition: "첫 결제 완료" }],
    ["select_candidate", { candidate: "AI로 많이 만들었지만 못 판 사람" }],
    ["record_alternative", { currentAlternative: "그냥 더 만든다" }],
    ["define_action_contract", { externalAction: "DM 발송", attemptThreshold: "3명", successCondition: "1명 결제" }],
    ["define_evidence_contract", { expectedProofKind: "payment", evidenceLocation: "스크린샷" }],
    ["schedule_execution", { dueAt: "2026-06-14T00:00:00.000Z", commitmentNote: "오늘 3명에게 보낸다" }],
  ];
  let revision = 0;
  for (let i = 0; i < gather.length; i++) {
    const [type, fields] = gather[i];
    const res = await commitAttemptEvent({
      workspaceRoot: workspacePath, attemptId, expectedRevision: revision,
      event: { type, fields, at: ATTEMPT_ISO, requestId: `seed-gather-${i}` },
    });
    revision = res.revision;
  }
  return { attemptId, revision };
}

test("office_hours_attempt_evidence: record_action_proof advances the attempt (happy path)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    const { attemptId, revision } = await seedScheduledAttempt(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "office_hours_attempt_evidence",
      workspaceRoot: harness.workspacePath,
      attemptId,
      expectedRevision: revision,
      transition: "record_action_proof",
      requestId: "evt-action-1",
      evidence: { kind: "dm_sent_screenshot", ref: "sim://day1/dm-cap.png", capturedAt: ATTEMPT_ISO, source: "test" },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.notEqual(state.success, false, `handler must not fail: ${state.error || ""}`);

    // The attempt advanced on disk and carries the graded action proof.
    const snapshot = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(snapshot.projection.status, "awaiting_customer_outcome");
    assert.equal(snapshot.projection.actionProof?.grade, "action_proof");
    assert.equal(snapshot.projection.actionProof?.kind, "dm_sent_screenshot");
    assert.equal(snapshot.projection.actionProof?.ref, "sim://day1/dm-cap.png");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_attempt_evidence: rejected evidence kind fails closed (no soften)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    const { attemptId, revision } = await seedScheduledAttempt(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "office_hours_attempt_evidence",
      workspaceRoot: harness.workspacePath,
      attemptId,
      expectedRevision: revision,
      transition: "record_action_proof",
      requestId: "evt-rejected-1",
      // "self_report" is in REJECTED_EVIDENCE_KINDS — never proves anything.
      evidence: { kind: "self_report", ref: "sim://day1/i-said-so.txt" },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.equal(state.success, false, "rejected evidence kind must fail closed");

    // The attempt did NOT advance — it is still scheduled, no actionProof.
    const snapshot = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(snapshot.projection.status, "execution_scheduled");
    assert.equal(snapshot.projection.actionProof, null);
    assert.equal(snapshot.revision, revision);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_attempt_evidence: wrong-grade evidence for the WAIT reason fails closed", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    const { attemptId, revision } = await seedScheduledAttempt(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "office_hours_attempt_evidence",
      workspaceRoot: harness.workspacePath,
      attemptId,
      expectedRevision: revision,
      // In execution_scheduled (WAIT reason "action") a customer_outcome kind is the
      // wrong grade for record_action_proof.
      transition: "record_action_proof",
      requestId: "evt-wrong-grade-1",
      evidence: { kind: "customer_reply", ref: "sim://day1/reply.png" },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.equal(state.success, false, "wrong-grade evidence must fail closed");

    const snapshot = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(snapshot.projection.status, "execution_scheduled");
    assert.equal(snapshot.revision, revision);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_attempt_evidence: missing evidence.ref fails closed (artifact locator required)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    const { attemptId, revision } = await seedScheduledAttempt(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "office_hours_attempt_evidence",
      workspaceRoot: harness.workspacePath,
      attemptId,
      expectedRevision: revision,
      transition: "record_action_proof",
      requestId: "evt-no-ref-1",
      evidence: { kind: "dm_sent_screenshot" }, // no ref → "kind only, no artifact"
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.equal(state.success, false, "missing evidence.ref must fail closed before commit");

    const snapshot = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(snapshot.projection.status, "execution_scheduled");
    assert.equal(snapshot.revision, revision);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_commitment_evidence rejects an attempt-scoped payload (two-writer fix)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "office_hours_commitment_evidence",
      workspaceRoot: harness.workspacePath,
      // A payload carrying an attemptId belongs to the attempt writer, not the
      // legacy commitment writer — it must be rejected (fail-closed).
      attemptId: "attempt-wait-1",
      commitmentId: "cm-anything",
      evidence: { kind: "screenshot", url: "sim://x.png" },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.equal(state.success, false, "an attempt-scoped payload must not reach the commitment writer");
    assert.match(String(state.error || ""), /office_hours_attempt_evidence/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

// ── FIX 2: record_goal_proof handler grade validation (consistent fail-closed) ─

// Drive a fresh attempt to outcome_observed (WAIT reason "goal") so a
// record_goal_proof jump is legal. Returns { attemptId, revision }.
async function seedOutcomeObservedAttempt(workspacePath, attemptId = "attempt-goal-1") {
  const { revision: r0 } = await seedScheduledAttempt(workspacePath, attemptId);
  let revision = r0;
  for (const [type, fields] of [
    ["record_action_proof", { evidence: { kind: "dm_sent_screenshot", ref: "sim://a.png" } }],
    ["record_customer_outcome", { evidence: { kind: "customer_reply", ref: "sim://b.png" } }],
  ]) {
    const res = await commitAttemptEvent({
      workspaceRoot: workspacePath, attemptId, expectedRevision: revision,
      event: { type, fields, at: ATTEMPT_ISO, requestId: `seed-${type}` },
    });
    revision = res.revision;
  }
  return { attemptId, revision };
}

test("office_hours_attempt_evidence: record_goal_proof accepts a goal_proof kind (happy path)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    const { attemptId, revision } = await seedOutcomeObservedAttempt(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "office_hours_attempt_evidence",
      workspaceRoot: harness.workspacePath,
      attemptId,
      expectedRevision: revision,
      transition: "record_goal_proof",
      requestId: "evt-goal-ok-1",
      // activation_event grades to goal_proof — the grade record_goal_proof requires.
      evidence: { kind: "activation_event", ref: "sim://day1/activation.png", source: "test" },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.notEqual(state.success, false, `goal_proof happy path must not fail: ${state.error || ""}`);

    const snapshot = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(snapshot.projection.status, "succeeded");
    assert.equal(snapshot.projection.goalProof?.grade, "goal_proof");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_attempt_evidence: record_goal_proof rejects a non-goal grade (FIX 2 — no exemption)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    const { attemptId, revision } = await seedOutcomeObservedAttempt(harness.workspacePath, "attempt-goal-2");
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "office_hours_attempt_evidence",
      workspaceRoot: harness.workspacePath,
      attemptId,
      expectedRevision: revision,
      transition: "record_goal_proof",
      requestId: "evt-goal-bad-1",
      // dm_sent_screenshot grades to action_proof — NOT goal_proof. The handler
      // previously EXEMPTED record_goal_proof from grade validation; FIX 2 makes it
      // fail closed consistently (the transition→grade map covers goal_proof).
      evidence: { kind: "dm_sent_screenshot", ref: "sim://day1/dm.png" },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.equal(state.success, false, "an action-grade kind for record_goal_proof must fail closed");
    assert.match(String(state.error || ""), /goal_proof/);

    // The attempt did NOT advance to succeeded.
    const snapshot = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(snapshot.projection.status, "outcome_observed");
    assert.equal(snapshot.projection.goalProof, null);
    assert.equal(snapshot.revision, revision);
  } finally {
    ws?.close();
    await harness.close();
  }
});

// ── FIX 2 invariant: an attempt goal proof never passes the strong-payment gate ─
// Past the early cycle the artifact gate (officeHoursEvidenceHasHardEvidence) only
// counts a proof_ledger ref with strength "strong". Attempt refs ALWAYS carry
// sourceType:"office_hours_attempt" and never proof_ledger/strong (load-bearing
// security invariant), so even a goal_proof attempt proof + a hard-intent ladder
// turn cannot satisfy the gate by construction.
test("strong-payment gate stays honest: an attempt goal_proof never counts as strong payment", async () => {
  const { officeHoursEvidenceHasHardEvidence, OFFICE_HOURS_ARTIFACT_GATE_MIN_CYCLE } =
    await import("../sidecar/office-hours-evidence-state.mjs");
  const cycle = OFFICE_HOURS_ARTIFACT_GATE_MIN_CYCLE; // force the strong-payment branch
  // A ladder turn that DOES assert a hard intent (so hasLadderHard is true) + an
  // attempt-sourced goal proof. With NO proof_ledger/strong ref present, the gate
  // must still refuse past the early cycle.
  const evidenceState = {
    references: [
      { sourceType: "office_hours_turn", signalId: "get_users_paid_entry", nextIntent: "actual_payment_or_contract", cycle },
      { sourceType: "office_hours_attempt", grade: "goal_proof", kind: "activation_event", ref: "sim://activation.png", cycle },
    ],
  };
  assert.equal(officeHoursEvidenceHasHardEvidence(evidenceState), false,
    "an attempt goal_proof (sourceType office_hours_attempt) must NOT satisfy the strong-payment artifact gate");

  // Same state PLUS a real verified strong proof_ledger payment → the gate passes.
  const withStrongPayment = {
    references: [
      ...evidenceState.references,
      { sourceType: "proof_ledger", strength: "strong", cycle },
    ],
  };
  assert.equal(officeHoursEvidenceHasHardEvidence(withStrongPayment), true,
    "only a real proof_ledger strong payment satisfies the gate (sanity: the gate is reachable)");
});

// ── FIX 3: two-writer reverse-lookup (workspace-scoped, attemptId-omitted bypass) ─

test("office_hours_commitment_evidence is rejected while an open get_users attempt owns Day-1 (FIX 3)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    // Seed an OPEN (non-terminal: execution_scheduled WAIT) get_users attempt — the
    // sole Day-1 writer. The legacy commitment writer must defer to it even when the
    // payload OMITS attemptId (the bypass the attemptId-on-payload reject misses).
    await seedScheduledAttempt(harness.workspacePath, "attempt-open-getusers");
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "office_hours_commitment_evidence",
      workspaceRoot: harness.workspacePath,
      // NO attemptId — exercises the reverse-lookup, not the payload-shape reject.
      commitmentId: "cm-anything",
      evidence: { kind: "screenshot", url: "sim://x.png" },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.equal(state.success, false, "a commitment write must be refused while a get_users attempt is open");
    assert.match(String(state.error || ""), /open get_users ValidationAttempt|office_hours_attempt_evidence/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_commitment_evidence passes the reverse-lookup when NO get_users attempt is open (FIX 3)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    // No attempt at all in this workspace (Day2+ / non-get_users commitment). The
    // reverse-lookup must NOT fire; the write proceeds to gradeCommitment, which
    // fails with "unknown commitment" (no commitment seeded) — a DIFFERENT error
    // proving the two-writer guard let it through.
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "office_hours_commitment_evidence",
      workspaceRoot: harness.workspacePath,
      commitmentId: "cm-not-seeded",
      evidence: { kind: "screenshot", url: "sim://y.png" },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.equal(state.success, false, "an unseeded commitment still fails (but at gradeCommitment, not the guard)");
    assert.match(String(state.error || ""), /unknown commitment/);
    assert.doesNotMatch(String(state.error || ""), /open get_users ValidationAttempt/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_commitment_evidence passes the reverse-lookup when the only get_users attempt is TERMINAL (FIX 3)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    // A get_users attempt that has been RESOLVED (failed via abandon) is terminal —
    // it no longer owns Day-1, so the commitment writer is free again.
    const { attemptId, revision } = await seedScheduledAttempt(harness.workspacePath, "attempt-terminal");
    await commitAttemptEvent({
      workspaceRoot: harness.workspacePath, attemptId, expectedRevision: revision,
      event: { type: "abandon_attempt", fields: { abandonReason: "test resolve" }, at: ATTEMPT_ISO, requestId: "seed-abandon" },
    });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "office_hours_commitment_evidence",
      workspaceRoot: harness.workspacePath,
      commitmentId: "cm-after-terminal",
      evidence: { kind: "screenshot", url: "sim://z.png" },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.equal(state.success, false);
    // Reached gradeCommitment (unknown commitment) — the guard did NOT fire on a terminal attempt.
    assert.match(String(state.error || ""), /unknown commitment/);
    assert.doesNotMatch(String(state.error || ""), /open get_users ValidationAttempt/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

// ── FIX 4: WAIT → abandon_attempt → failed → canStartNewAttempt reachable ──────

test("office_hours_attempt_evidence: abandon_attempt escapes a WAIT attempt → failed → canStartNewAttempt (FIX 4)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    // A WAIT attempt (execution_scheduled) wedges canStartNewAttempt until resolved.
    const { attemptId, revision } = await seedScheduledAttempt(harness.workspacePath, "attempt-escape");
    const before = await loadAttemptLog({ workspaceRoot: harness.workspacePath });
    const beforeProjections = await Promise.all(
      Object.values(before.attempts).map(async (r) =>
        (await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId: r.attemptId })).projection),
    );
    assert.equal(canStartNewAttempt(beforeProjections), false,
      "an open WAIT attempt must block a new attempt before the escape");

    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "office_hours_attempt_evidence",
      workspaceRoot: harness.workspacePath,
      attemptId,
      expectedRevision: revision,
      transition: "abandon_attempt",
      requestId: "evt-abandon-1",
      abandonReason: "founder cannot run this today; abandoning the lease",
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.notEqual(state.success, false, `abandon_attempt from WAIT must succeed: ${state.error || ""}`);

    const snapshot = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(snapshot.projection.status, "failed", "abandon_attempt resolves the attempt to failed");

    const after = await loadAttemptLog({ workspaceRoot: harness.workspacePath });
    const afterProjections = await Promise.all(
      Object.values(after.attempts).map(async (r) =>
        (await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId: r.attemptId })).projection),
    );
    assert.equal(canStartNewAttempt(afterProjections), true,
      "after the WAIT attempt is abandoned (failed), a new attempt may start");
  } finally {
    ws?.close();
    await harness.close();
  }
});

// ── harness (mirrors sidecar-tests/request-emit.test.mjs) ─────────────────────
async function spawnSidecar({ extraEnv = {} } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-attempt-evidence-"));
  const workspace = path.join(root, "workspace");
  const appSupport = path.join(root, "app-support");
  const homePath = path.join(root, "home");
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(appSupport, { recursive: true });
  await fs.mkdir(homePath, { recursive: true });

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspace], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupport,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      HOME: homePath,
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for sidecar-ready. stderr:\n${stderr}`));
    }, 10_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "sidecar-ready" && parsed.port && parsed.authToken) {
            clearTimeout(timer);
            resolve(parsed);
          }
        } catch { /* ignore non-ready stdout */ }
      }
    });
  });

  return {
    port: ready.port,
    authToken: ready.authToken,
    workspacePath: workspace,
    appSupportPath: appSupport,
    async close() {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(resolve, 2_000);
      });
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function connectAndCollect(harness) {
  const ws = new WebSocket(`ws://127.0.0.1:${harness.port}`);
  ws.events = [];
  ws.on("message", (raw) => { ws.events.push(JSON.parse(String(raw))); });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "authenticate", authToken: harness.authToken }));
  await waitForEvent(ws.events, (event) => event.type === "ready");
  return ws;
}

async function waitForEvent(events, predicate, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const summary = events.map((event) => {
    if (event.type === "error") return `error:${event.message || ""}`;
    if (event.type === "day_progress_state") return `day_progress_state:success=${event.success}`;
    return event.type;
  });
  throw new Error(`Timed out waiting for event. Saw: ${summary.join(", ")}`);
}

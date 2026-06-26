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
import { signEvidenceReceipt } from "../sidecar/office-hours-evidence-receipt.mjs";
import { resolveHostIdentity, resolveEvidenceSigningKey } from "../sidecar/office-hours-host-identity.mjs";
import { deriveEvidenceContractId } from "../sidecar/office-hours-evidence-binding.mjs";
import { deriveEvidenceIdentity, registerArtifact } from "../sidecar/office-hours-artifact-registry.mjs";

// A 1px-ish PNG (magic bytes + filler) used as a real "screenshot" artifact for the
// swift-upload ingress path.
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("day1-capture-bytes")]);

// Ingest founder bytes through the daemon and return the host-signed receipt token (the
// production action-proof path: bytes → sha → register → sign).
async function ingestActionReceipt(ws, { workspaceRoot, attemptId, bytes = PNG_BYTES }) {
  ws.send(JSON.stringify({
    type: "office_hours_ingest_evidence",
    workspaceRoot,
    attemptId,
    evidence: { bytesBase64: Buffer.from(bytes).toString("base64"), declaredMediaType: "image/png" },
  }));
  const ev = await waitForEvent(ws.events, (e) => e.type === "office_hours_evidence_ingested" && e.attemptId === attemptId);
  if (!ev.success) throw new Error(`ingest failed: ${ev.error || ""}`);
  return ev.receiptToken;
}

// Sign a SYNTHETIC higher-tier receipt (provider_event / recipient_callback) for tests
// that exercise the customer_outcome / goal_proof handler path, which production cannot
// mint yet (no provider adapter). Uses the SAME host store the daemon verifies against
// (shared via AGENTIC30_HOST_STORE_DIR) and the contract id derived from durable state.
async function signSyntheticReceipt({ storeDir, workspaceRoot, attemptId, origin, verifiedClaims }) {
  // Anchor freshness to the daemon's real clock (it verifies with `new Date()`); a fixed
  // past timestamp would be rejected as expired.
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const prev = process.env.AGENTIC30_HOST_STORE_DIR;
  process.env.AGENTIC30_HOST_STORE_DIR = storeDir;
  try {
    const { installActorId, projectId } = await resolveHostIdentity({ workspaceRoot });
    const { keyId, secret } = await resolveEvidenceSigningKey({ workspaceRoot });
    const snapshot = await projectAttempt({ workspaceRoot, attemptId });
    const evidenceContractId = deriveEvidenceContractId(snapshot.projection);
    const sha = "c".repeat(64);
    const account = origin === "provider_event" ? "stripe_acct_test" : undefined;
    const eventId = origin === "provider_event" ? `evt_${attemptId}` : undefined;
    const nonce = origin === "recipient_callback" ? `nonce_${attemptId}` : undefined;
    const evidenceIdentity = deriveEvidenceIdentity({ origin, providerAccount: account, providerEventId: eventId, callbackNonce: nonce, actorId: installActorId, sha256: sha });
    const artifactId = `art_${attemptId}`;
    // The registry lives in the workspace (shared with the daemon); the synthetic
    // identity must be registered so the handler's consume succeeds.
    await registerArtifact({ workspaceRoot }, {
      evidenceIdentity, artifactId, sha256: sha, origin, mediaType: "application/json", byteLength: 321,
    });
    return signEvidenceReceipt({
      evidenceIdentity,
      artifactId,
      projectId,
      attemptId,
      actorId: installActorId,
      evidenceContractId,
      sha256: sha,
      byteLength: 321,
      declaredMediaType: "application/json",
      detectedMediaType: "application/json",
      contentValidation: "provider_event_verified",
      origin,
      issuedAt,
      expiresAt,
      verifiedClaims,
    }, { secret, keyId });
  } finally {
    if (prev === undefined) delete process.env.AGENTIC30_HOST_STORE_DIR;
    else process.env.AGENTIC30_HOST_STORE_DIR = prev;
  }
}

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

test("office_hours_attempt_evidence: record_action_proof via a host-signed swift-upload receipt (happy path)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    const { attemptId, revision } = await seedScheduledAttempt(harness.workspacePath);
    ws = await connectAndCollect(harness);

    // Production rail: ingest founder bytes → host-signed receipt token → submit the token.
    const receiptToken = await ingestActionReceipt(ws, { workspaceRoot: harness.workspacePath, attemptId });
    ws.send(JSON.stringify({
      type: "office_hours_attempt_evidence",
      workspaceRoot: harness.workspacePath,
      attemptId,
      expectedRevision: revision,
      transition: "record_action_proof",
      requestId: "evt-action-1",
      evidence: { receipt: receiptToken },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.notEqual(state.success, false, `handler must not fail: ${state.error || ""}`);

    // The attempt advanced and carries the HOST-MINTED action proof: the kind is derived
    // from the verified claim (message.sent → message_log), the ref points at the durable
    // content-addressed artifact, and the receipt provenance is preserved.
    const snapshot = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(snapshot.projection.status, "awaiting_customer_outcome");
    assert.equal(snapshot.projection.actionProof?.grade, "action_proof");
    assert.equal(snapshot.projection.actionProof?.kind, "message_log");
    assert.match(String(snapshot.projection.actionProof?.ref || ""), /^artifact:\/\/[0-9a-f]{64}$/);
    assert.equal(snapshot.projection.actionProof?.verifiedClaim, "message.sent");
    assert.equal(snapshot.projection.actionProof?.source, "host_receipt_v3");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_attempt_evidence: a raw {kind,ref} payload is refused (receipt_required, no compat)", async () => {
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
      requestId: "evt-raw-1",
      // The legacy self-attested path: a kind + a sim:// ref, but NO host-signed receipt.
      // The A′ cutover refuses this with receipt_required (no backward compatibility).
      evidence: { kind: "dm_sent_screenshot", ref: "sim://day1/i-said-so.png" },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.equal(state.success, false, "a raw {kind,ref} payload must fail closed");
    assert.match(String(state.error || ""), /receipt_required/);

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

test("office_hours_attempt_evidence: a forged/garbage receipt is rejected (no valid MAC)", async () => {
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
      requestId: "evt-forged-1",
      // A well-formed v3 token shape whose MAC was not produced by the host key.
      evidence: { receipt: "v3.eyJmb3JnZWQiOnRydWV9.Zm9yZ2VkbWFj" },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.equal(state.success, false, "a forged receipt must fail closed");
    assert.match(String(state.error || ""), /receipt_rejected/);

    const snapshot = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(snapshot.projection.status, "execution_scheduled");
    assert.equal(snapshot.revision, revision);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_attempt_evidence: an identical submit (same requestId) is idempotent (applied once)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    const { attemptId, revision } = await seedScheduledAttempt(harness.workspacePath, "attempt-idem");
    ws = await connectAndCollect(harness);

    const receiptToken = await ingestActionReceipt(ws, { workspaceRoot: harness.workspacePath, attemptId });
    const submit = () => ws.send(JSON.stringify({
      type: "office_hours_attempt_evidence", workspaceRoot: harness.workspacePath, attemptId,
      expectedRevision: revision, transition: "record_action_proof", requestId: "evt-idem-1", evidence: { receipt: receiptToken },
    }));

    submit();
    const first = await waitForEvent(ws.events, (e) => e.type === "day_progress_state" && e.workspaceRoot === harness.workspacePath);
    assert.notEqual(first.success, false, `first submit must succeed: ${first.error || ""}`);
    const afterFirst = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(afterFirst.projection.status, "awaiting_customer_outcome");
    const revAfterFirst = afterFirst.revision;

    // Re-send the EXACT same submit (network-retry). The idempotency guard must skip the
    // dry-run + re-consume, and commit dedupes → no double-apply, revision unchanged.
    submit();
    await new Promise((r) => setTimeout(r, 400));
    const afterRetry = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(afterRetry.projection.status, "awaiting_customer_outcome", "retry must not advance further");
    assert.equal(afterRetry.revision, revAfterFirst, "retry must not bump the revision (single apply)");
    // Exactly one action proof recorded.
    assert.equal(afterRetry.projection.actionProof?.kind, "message_log");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_attempt_evidence: concurrent same-attempt submits advance EXACTLY once (TOCTOU-safe)", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    const { attemptId, revision } = await seedScheduledAttempt(harness.workspacePath, "attempt-race");
    ws = await connectAndCollect(harness);

    // Two DISTINCT action receipts (different bytes → different artifacts/identities).
    const tokenA = await ingestActionReceipt(ws, { workspaceRoot: harness.workspacePath, attemptId, bytes: Buffer.concat([PNG_BYTES, Buffer.from("A")]) });
    const tokenB = await ingestActionReceipt(ws, { workspaceRoot: harness.workspacePath, attemptId, bytes: Buffer.concat([PNG_BYTES, Buffer.from("B")]) });

    const offset = ws.events.length;
    // Fire BOTH with the SAME expectedRevision — they race on the attempt-store lock. The
    // verify+consume+append run inside that lock (preAppend), so the loser CAS-conflicts
    // BEFORE its receipt is verified/consumed: exactly one advance, no double-apply, no burn.
    ws.send(JSON.stringify({ type: "office_hours_attempt_evidence", workspaceRoot: harness.workspacePath, attemptId, expectedRevision: revision, transition: "record_action_proof", requestId: "evt-race-A", evidence: { receipt: tokenA } }));
    ws.send(JSON.stringify({ type: "office_hours_attempt_evidence", workspaceRoot: harness.workspacePath, attemptId, expectedRevision: revision, transition: "record_action_proof", requestId: "evt-race-B", evidence: { receipt: tokenB } }));

    const startedAt = Date.now();
    let responses = [];
    while (Date.now() - startedAt < 15_000) {
      responses = ws.events.slice(offset).filter((e) => e.type === "day_progress_state" && e.workspaceRoot === harness.workspacePath);
      if (responses.length >= 2) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(responses.length, 2, "both submits must respond");
    const successes = responses.filter((r) => r.success !== false).length;
    assert.equal(successes, 1, "exactly one concurrent submit may advance the attempt");

    const snapshot = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(snapshot.projection.status, "awaiting_customer_outcome");
    assert.equal(snapshot.revision, revision + 1, "exactly one event applied (no double-apply)");
    assert.equal(snapshot.projection.actionProof?.kind, "message_log");
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

test("office_hours_attempt_evidence: record_goal_proof via a verified provider receipt (synthetic provider, eval-only)", async () => {
  // Production has no goal-proof adapter yet; a verified first-party provider event
  // (Stripe-style conversion) is what legitimately advances goal proof. We sign one
  // against the SAME host store the daemon verifies against to exercise the plumbing.
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "a30-attempt-goalstore-"));
  const harness = await spawnSidecar({ extraEnv: { AGENTIC30_HOST_STORE_DIR: storeDir } });
  let ws;
  try {
    const { attemptId, revision } = await seedOutcomeObservedAttempt(harness.workspacePath);
    ws = await connectAndCollect(harness);

    const receiptToken = await signSyntheticReceipt({
      storeDir, workspaceRoot: harness.workspacePath, attemptId,
      origin: "provider_event", verifiedClaims: ["goal.metric_observed"],
    });
    ws.send(JSON.stringify({
      type: "office_hours_attempt_evidence",
      workspaceRoot: harness.workspacePath,
      attemptId,
      expectedRevision: revision,
      transition: "record_goal_proof",
      requestId: "evt-goal-ok-1",
      evidence: { receipt: receiptToken },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.notEqual(state.success, false, `goal_proof via provider receipt must succeed: ${state.error || ""}`);

    const snapshot = await projectAttempt({ workspaceRoot: harness.workspacePath, attemptId });
    assert.equal(snapshot.projection.status, "succeeded");
    assert.equal(snapshot.projection.goalProof?.grade, "goal_proof");
    assert.equal(snapshot.projection.goalProof?.kind, "activation_event");
  } finally {
    ws?.close();
    await harness.close();
    await fs.rm(storeDir, { recursive: true, force: true });
  }
});

test("office_hours_attempt_evidence: an action receipt presented for record_goal_proof is insufficient", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    const { attemptId, revision } = await seedOutcomeObservedAttempt(harness.workspacePath, "attempt-goal-2");
    ws = await connectAndCollect(harness);

    // An uploaded screenshot can only ever be action_proof; presenting it for a goal proof
    // must be refused (the honest ceiling — a founder capture can't prove the goal happened).
    const receiptToken = await ingestActionReceipt(ws, { workspaceRoot: harness.workspacePath, attemptId });
    ws.send(JSON.stringify({
      type: "office_hours_attempt_evidence",
      workspaceRoot: harness.workspacePath,
      attemptId,
      expectedRevision: revision,
      transition: "record_goal_proof",
      requestId: "evt-goal-bad-1",
      evidence: { receipt: receiptToken },
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state" && event.workspaceRoot === harness.workspacePath);
    assert.equal(state.success, false, "an action receipt for record_goal_proof must fail closed");
    assert.match(String(state.error || ""), /receipt_insufficient_for_record_goal_proof/);

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

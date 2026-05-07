/**
 * REGRESSION TEST: bip_token_expired must be emitted in addition to (not instead of)
 * bip_coach_error when refreshBipCoachEvidence encounters invalid_rapt/invalid_grant.
 *
 * Tests the isInvalidRapt() classification and the dual-broadcast contract.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatBipCoachGwsError,
} from "../sidecar/bip-coach-state.mjs";
import { formatReadinessError } from "../sidecar/bip-readiness.mjs";

// --- isInvalidRapt logic (tested via formatReadinessError classification) ---

test("invalid_rapt error classified as auth_expired", () => {
  const err = formatReadinessError(new Error(
    "keyring error[auth]: Authentication failed: Failed to get token: Server error: invalid_rapt",
  ));
  assert.equal(err.kind, "auth_expired");
});

test("invalid_grant error classified as auth_expired", () => {
  const err = formatReadinessError(new Error(
    "Failed to get token: Server error: invalid_grant",
  ));
  assert.equal(err.kind, "auth_expired");
});

test("authentication failed error classified as auth_expired", () => {
  const err = formatReadinessError(new Error("Authentication failed"));
  assert.equal(err.kind, "auth_expired");
});

test("non-auth errors are NOT classified as auth_expired", () => {
  const err = formatReadinessError(new Error("permission denied"));
  assert.notEqual(err.kind, "auth_expired");
});

// --- Dual-broadcast contract (simulated) ---
//
// We can't import index.mjs (it starts a WebSocket server), so we simulate
// the relevant logic: formatBipCoachGwsError + isInvalidRapt → two broadcasts.

function isInvalidRapt(error) {
  const msg = error instanceof Error ? error.message : String(error || "");
  const lower = msg.toLowerCase();
  return lower.includes("invalid_rapt") || lower.includes("invalid_grant");
}

function simulateRefreshBipCoachEvidenceError(error, broadcasts) {
  const userError = formatBipCoachGwsError(error);
  // Always emit bip_coach_error
  broadcasts.push({ type: "bip_coach_error", message: userError });
  // Additionally emit bip_token_expired when token expired
  if (isInvalidRapt(error)) {
    broadcasts.push({ type: "bip_token_expired", message: userError });
  }
}

test("invalid_rapt error emits both bip_coach_error AND bip_token_expired", () => {
  const broadcasts = [];
  simulateRefreshBipCoachEvidenceError(
    new Error("Server error: invalid_rapt"),
    broadcasts,
  );

  const types = broadcasts.map((b) => b.type);
  assert.ok(types.includes("bip_coach_error"), "bip_coach_error must be emitted");
  assert.ok(types.includes("bip_token_expired"), "bip_token_expired must ALSO be emitted");
  assert.equal(broadcasts.length, 2, "exactly 2 broadcasts");
});

test("invalid_grant error emits both bip_coach_error AND bip_token_expired", () => {
  const broadcasts = [];
  simulateRefreshBipCoachEvidenceError(
    new Error("Failed to get token: Server error: invalid_grant"),
    broadcasts,
  );

  const types = broadcasts.map((b) => b.type);
  assert.ok(types.includes("bip_coach_error"));
  assert.ok(types.includes("bip_token_expired"));
});

test("permission_denied error emits ONLY bip_coach_error (no token expired)", () => {
  const broadcasts = [];
  simulateRefreshBipCoachEvidenceError(
    new Error("permission denied on document"),
    broadcasts,
  );

  const types = broadcasts.map((b) => b.type);
  assert.ok(types.includes("bip_coach_error"), "bip_coach_error must be emitted");
  assert.ok(!types.includes("bip_token_expired"), "bip_token_expired must NOT be emitted");
  assert.equal(broadcasts.length, 1, "exactly 1 broadcast");
});

test("network error emits ONLY bip_coach_error (no token expired)", () => {
  const broadcasts = [];
  simulateRefreshBipCoachEvidenceError(
    new Error("ECONNREFUSED: connection refused"),
    broadcasts,
  );

  assert.equal(broadcasts.filter((b) => b.type === "bip_coach_error").length, 1);
  assert.equal(broadcasts.filter((b) => b.type === "bip_token_expired").length, 0);
});

test("bip_token_expired message is user-facing Korean string for full error", () => {
  const broadcasts = [];
  simulateRefreshBipCoachEvidenceError(
    new Error("Authentication failed: Failed to get token: Server error: invalid_rapt"),
    broadcasts,
  );
  const expired = broadcasts.find((b) => b.type === "bip_token_expired");
  assert.ok(expired, "bip_token_expired emitted");
  assert.ok(expired.message.length > 0, "message is non-empty");
  // formatBipCoachGwsError maps authentication failed → Korean reconnect instruction
  assert.match(expired.message, /Google 연결이 만료됐어요/);
  assert.doesNotMatch(expired.message, /keyring/i);
});

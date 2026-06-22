import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ACTIVE_USERS_SCHEMA_VERSION,
  DEFAULT_FIRST_VALUE_EVENT,
  EQUIVALENT_VERIFIED_SOURCE,
  buildFirstValueCountQuery,
  collectActiveUserSnapshot,
  collectEquivalentActiveUserSnapshot,
  countVerifiedActiveUserIdentities,
  latestFirstValueSignal,
  loadActiveUsersStore,
  resolveActiveUsersPath,
} from "../sidecar/active-users-snapshot.mjs";
import { evaluateProgramGates, GATE_STATES } from "../sidecar/program-gate-engine.mjs";

const T0 = new Date("2026-06-12T09:00:00.000Z");

function fetchStub(results) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({ results }),
    };
  };
  return { impl, calls };
}

const validSettings = { tokenValid: true, token: "phx_test", region: "us" };

test("first_value count query targets the configured event with cumulative distinct persons", () => {
  assert.equal(
    buildFirstValueCountQuery(),
    "SELECT count(DISTINCT person_id) AS users FROM events WHERE event = 'first_value'",
  );
  assert.match(
    buildFirstValueCountQuery({ eventName: "o'clock" }),
    /event = 'o''clock'/,
  );
  // A trailing backslash must not neutralize the closing quote (HogQL/
  // ClickHouse honors backslash escapes in string literals).
  assert.match(
    buildFirstValueCountQuery({ eventName: "evil\\" }),
    /event = 'evil\\\\'$/,
  );
});

test("collectActiveUserSnapshot persists a snapshot via the mocked HogQL API", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-active-users-"));
  const { impl, calls } = fetchStub([[7]]);

  const result = await collectActiveUserSnapshot({
    workspaceRoot: root,
    day: 14,
    settings: validSettings,
    fetchImpl: impl,
    now: T0,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.snapshot.activeUserCount, 7);
  assert.equal(result.snapshot.day, 14);
  assert.equal(result.snapshot.firstValueEventName, DEFAULT_FIRST_VALUE_EVENT);
  assert.equal(result.snapshot.source, "posthog_hogql");
  assert.ok(result.snapshot.queryFingerprint.length === 16);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /us\.posthog\.com\/api\/projects\/@current\/query\//);
  assert.equal(calls[0].body.query.kind, "HogQLQuery");

  const store = await loadActiveUsersStore({ workspaceRoot: root });
  assert.equal(store.schemaVersion, ACTIVE_USERS_SCHEMA_VERSION);
  assert.equal(store.snapshots.length, 1);
  assert.equal(
    resolveActiveUsersPath(root),
    path.join(root, ".agentic30", "metrics", "active-users.json"),
  );

  // Same-day re-collection replaces the prior snapshot (일 1회, §15.4).
  const again = await collectActiveUserSnapshot({
    workspaceRoot: root,
    day: 14,
    settings: validSettings,
    fetchImpl: fetchStub([[9]]).impl,
    now: new Date("2026-06-12T21:00:00.000Z"),
  });
  assert.equal(again.store.snapshots.length, 1);
  assert.equal(again.store.snapshots[0].activeUserCount, 9);
});

test("source unavailability and query failure write nothing (fail-closed)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-active-users-fail-"));

  const unavailable = await collectActiveUserSnapshot({
    workspaceRoot: root,
    settings: { tokenValid: false },
    fetchImpl: fetchStub([[3]]).impl,
    now: T0,
  });
  assert.equal(unavailable.status, "source_unavailable");

  const failing = await collectActiveUserSnapshot({
    workspaceRoot: root,
    settings: validSettings,
    fetchImpl: async () => ({ ok: false, json: async () => ({ detail: "401" }) }),
    now: T0,
  });
  assert.equal(failing.status, "query_failed");

  const store = await loadActiveUsersStore({ workspaceRoot: root });
  assert.equal(store.snapshots.length, 0);
  assert.equal(await latestFirstValueSignal({ workspaceRoot: root }), null);
});

test("latest snapshot feeds G4② as the firstValue gate input", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-active-users-g4-"));
  await collectActiveUserSnapshot({
    workspaceRoot: root,
    day: 14,
    settings: validSettings,
    fetchImpl: fetchStub([[1]]).impl,
    now: T0,
  });

  const firstValue = await latestFirstValueSignal({ workspaceRoot: root });
  assert.equal(firstValue.observed, true);
  assert.equal(firstValue.rowCount, 1);

  const evaluation = evaluateProgramGates({
    proofLedger: {
      events: [
        { id: "supporting-1", type: "landing_metric", day: 6, status: "verified", strength: "medium", polarity: "supporting" },
        { id: "counter-1", type: "interview", day: 5, status: "verified", strength: "strong", polarity: "counter" },
        { id: "decision-1", type: "day_decision", day: 7, status: "accepted", decision: "continue" },
        { id: "ask-1", type: "payment_intent", day: 14, status: "accepted", strength: "strong" },
      ],
    },
    currentDay: 15,
    firstValue,
    sources: { posthogAvailable: true },
    now: T0,
  });
  assert.equal(evaluation.gates.G4.state, GATE_STATES.passed);

  // Zero rows → observed=false → G4② genuinely unmet (no provisional).
  await collectActiveUserSnapshot({
    workspaceRoot: root,
    day: 15,
    settings: validSettings,
    fetchImpl: fetchStub([[0]]).impl,
    now: new Date("2026-06-13T09:00:00.000Z"),
  });
  const zero = await latestFirstValueSignal({ workspaceRoot: root });
  assert.equal(zero.observed, false);
  assert.equal(zero.rowCount, 0);
});

// --- §6.1 equivalent source adapter (verified-evidence count) ---

test("countVerifiedActiveUserIdentities counts only verified activation evidence by unique identity", () => {
  // Two verified first_value events for the SAME identity collapse to 1.
  const ledger = {
    events: [
      { id: "a", type: "action_evidence", status: "verified", metadata: { kind: "first_value", identity: "u1" } },
      { id: "b", type: "action_evidence", status: "accepted", metadata: { kind: "first_value", identity: "u1" } },
      { id: "c", type: "action_evidence", status: "verified", metadata: { kind: "active_user", identity: "u2" } },
    ],
  };
  assert.equal(countVerifiedActiveUserIdentities(ledger), 2);
});

test("manual_proof_required / submitted / self-report never produce a count (verified only)", () => {
  // No verified evidence at all → null (source-unavailable, not a zero count).
  assert.equal(
    countVerifiedActiveUserIdentities({
      events: [
        { id: "p", type: "action_evidence", status: "submitted", metadata: { kind: "first_value", identity: "u1" } },
        { id: "q", type: "action_evidence", status: "manual_proof_required", metadata: { kind: "active_user", identity: "u2" } },
        // Verified, but not an activation kind → excluded (signup/visit/self-report).
        { id: "r", type: "action_evidence", status: "verified", metadata: { kind: "signup", identity: "u3" } },
        { id: "s", type: "interview", status: "verified", strength: "strong", customer: "u4" },
      ],
    }),
    null,
  );
});

test("equivalent adapter activates when PostHog is unavailable and tags source explicitly", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-active-users-equiv-"));
  const proofLedger = {
    events: [
      { id: "e1", type: "action_evidence", status: "verified", metadata: { kind: "first_value", identity: "alice" } },
      { id: "e2", type: "action_evidence", status: "accepted", metadata: { kind: "core_activation", identity: "bob" } },
      // Provisional row must NOT bump the count.
      { id: "e3", type: "action_evidence", status: "submitted", metadata: { kind: "first_value", identity: "carol" } },
    ],
  };

  const result = await collectActiveUserSnapshot({
    workspaceRoot: root,
    day: 14,
    settings: { tokenValid: false },
    proofLedger,
    now: T0,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.snapshot.source, EQUIVALENT_VERIFIED_SOURCE);
  assert.equal(result.snapshot.activeUserCount, 2);

  // The persisted snapshot drives G4②/G5 as a verified active-user count.
  const firstValue = await latestFirstValueSignal({ workspaceRoot: root });
  assert.equal(firstValue.observed, true);
  assert.equal(firstValue.rowCount, 2);

  const evaluation = evaluateProgramGates({
    proofLedger: {
      events: [
        { id: "decision-1", type: "day_decision", day: 7, status: "accepted", decision: "continue" },
        { id: "ask-1", type: "payment_intent", day: 14, status: "accepted", strength: "strong" },
        { id: "interview-1", type: "interview", day: 5, status: "verified", strength: "strong" },
      ],
    },
    currentDay: 15,
    firstValue,
    sources: { posthogAvailable: false },
    now: T0,
  });
  // G4② first_value_observed satisfied via the equivalent verified count.
  assert.equal(evaluation.gates.G4.state, GATE_STATES.passed);
});

test("equivalent adapter with no verified evidence fails closed (writes nothing)", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-active-users-equiv-empty-"));
  const result = await collectEquivalentActiveUserSnapshot({
    workspaceRoot: root,
    day: 14,
    proofLedger: {
      events: [
        { id: "only-submitted", type: "action_evidence", status: "manual_proof_required", metadata: { kind: "first_value", identity: "u1" } },
      ],
    },
    now: T0,
  });
  assert.equal(result.status, "source_unavailable");
  assert.equal(result.snapshot, null);
  const store = await loadActiveUsersStore({ workspaceRoot: root });
  assert.equal(store.snapshots.length, 0);
});

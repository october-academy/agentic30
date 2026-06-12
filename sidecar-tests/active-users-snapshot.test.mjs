import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ACTIVE_USERS_SCHEMA_VERSION,
  DEFAULT_FIRST_VALUE_EVENT,
  buildFirstValueCountQuery,
  collectActiveUserSnapshot,
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

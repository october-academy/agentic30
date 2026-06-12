import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createTelemetryClient,
  normalizeProgramTelemetryContext,
} from "../sidecar/telemetry.mjs";
import {
  evaluateProgramGates,
  resolveActiveGate,
  resolveProgramPhase,
} from "../sidecar/program-gate-engine.mjs";

const T0 = new Date("2026-06-12T09:00:00.000Z");

test("program telemetry context keeps scalars only and drops invalid values", () => {
  assert.deepEqual(
    normalizeProgramTelemetryContext({
      programDay: 14,
      programPhase: "build",
      activeGate: "G4",
      gateState: "blocked",
    }),
    { program_day: 14, program_phase: "build", active_gate: "G4", gate_state: "blocked" },
  );
  assert.deepEqual(normalizeProgramTelemetryContext({ programDay: -1 }), {});
  assert.deepEqual(normalizeProgramTelemetryContext({ programDay: 999 }), {});
  assert.deepEqual(normalizeProgramTelemetryContext(null), {});
  // No user content fields survive — only the four §16.1 scalars.
  assert.deepEqual(
    Object.keys(normalizeProgramTelemetryContext({
      programDay: 8,
      customerName: "조은성",
      message: "원문",
    })),
    ["program_day"],
  );
});

test("telemetry client caches the program context for baseProperties injection", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-telemetry-ctx-"));
  const client = createTelemetryClient({
    appSupportPath,
    workspaceRoot: "/tmp/product",
    environment: { AGENTIC30_DISABLE_TELEMETRY: "1" },
  });
  assert.deepEqual(client.getProgramContext(), {});
  client.setProgramContext({ programDay: 9, programPhase: "build", activeGate: "G4", gateState: "open" });
  assert.deepEqual(client.getProgramContext(), {
    program_day: 9,
    program_phase: "build",
    active_gate: "G4",
    gate_state: "open",
  });
  client.setProgramContext({});
  assert.deepEqual(client.getProgramContext(), {});
});

test("program phase trails on blocked gates while the day clock runs (§14.1)", () => {
  const foundationEvents = [];
  const blockedAtDay9 = evaluateProgramGates({
    proofLedger: { events: foundationEvents },
    currentDay: 9,
    now: T0,
  });
  // Day 9 but G2 unmet → phase stays foundation (clock ≠ phase).
  assert.equal(resolveProgramPhase(blockedAtDay9), "foundation");
  assert.equal(resolveActiveGate(blockedAtDay9).gateId, "G1");

  const buildEvents = [
    { id: "supporting-1", type: "landing_metric", day: 6, status: "verified", strength: "medium", polarity: "supporting" },
    { id: "counter-1", type: "interview", day: 5, status: "verified", strength: "strong", polarity: "counter" },
    { id: "decision-1", type: "day_decision", day: 7, status: "accepted", decision: "continue" },
  ];
  const buildPhase = evaluateProgramGates({
    proofLedger: { events: buildEvents },
    currentDay: 9,
    now: T0,
  });
  assert.equal(resolveProgramPhase(buildPhase), "build");
  assert.equal(resolveActiveGate(buildPhase).gateId, "G4");

  const launchPhase = evaluateProgramGates({
    proofLedger: {
      events: [
        ...buildEvents,
        { id: "ask-1", type: "payment_intent", day: 14, status: "accepted", strength: "strong" },
      ],
    },
    currentDay: 15,
    firstValue: { observed: true, rowCount: 2 },
    sources: { posthogAvailable: true },
    now: T0,
  });
  assert.equal(resolveProgramPhase(launchPhase), "launch");
});

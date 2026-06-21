import test from "node:test";
import assert from "node:assert/strict";

async function buildProgramScoreboardSnapshot(input) {
  const mod = await import("../sidecar/program-scoreboard.mjs");
  return mod.buildProgramScoreboardSnapshot(input);
}

test("malformed proofEvents entries fail explicitly", async () => {
  await assert.rejects(
    buildProgramScoreboardSnapshot({
      proofEvents: [
        null,
        { id: "record-1", type: "payment_record", status: "verified" },
      ],
    }),
    /ERR_INVALID_PROOF_EVENT: proofEvents\[0\] must be an object\./,
  );
});

test("malformed proofLedger false entries fail explicitly", async () => {
  await assert.rejects(
    buildProgramScoreboardSnapshot({
      proofLedger: {
        events: [
          false,
          { id: "record-1", type: "payment_record", status: "verified" },
        ],
      },
    }),
    /ERR_INVALID_PROOF_EVENT: proofLedger\.events\[0\] must be an object\./,
  );
});

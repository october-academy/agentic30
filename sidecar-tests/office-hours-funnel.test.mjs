// The outcome-capture funnel must: separate eval vs production epochs (so synthetic
// arc runs never pollute real N), emit ONLY non-raw domain fields (no bytes/ref/receipt/
// note/customer text), and fail closed on an unknown stage.
import test from "node:test";
import assert from "node:assert/strict";

import {
  OFFICE_HOURS_FUNNEL_EVENTS,
  resolveMetricEpoch,
  buildFunnelEventProps,
  emitOfficeHoursFunnelEvent,
} from "../sidecar/office-hours-funnel.mjs";

test("resolveMetricEpoch: default production; eval only when explicitly set; invalid → production", () => {
  assert.equal(resolveMetricEpoch({}), "production");
  assert.equal(resolveMetricEpoch({ AGENTIC30_METRIC_EPOCH: "eval" }), "eval");
  assert.equal(resolveMetricEpoch({ AGENTIC30_METRIC_EPOCH: "EVAL" }), "eval");
  assert.equal(resolveMetricEpoch({ AGENTIC30_METRIC_EPOCH: "nonsense" }), "production");
  assert.equal(resolveMetricEpoch({ AGENTIC30_METRIC_EPOCH: "" }), "production");
});

test("buildFunnelEventProps stamps protocol + epoch + stage and carries the join/grade fields", () => {
  const props = buildFunnelEventProps({
    stage: "action_proof_landed", attemptId: "att_1", transition: "record_action_proof",
    trustTier: "artifact_backed", grade: "action_proof", detectedMediaType: "image/png",
    occurredAt: "2026-06-26T10:00:00.000Z", day: 1,
  }, { AGENTIC30_METRIC_EPOCH: "eval" });
  assert.equal(props.funnelProtocol, 1);
  assert.equal(props.metricEpoch, "eval");
  assert.equal(props.funnelStage, "action_proof_landed");
  assert.equal(props.attemptId, "att_1");
  assert.equal(props.transition, "record_action_proof");
  assert.equal(props.trustTier, "artifact_backed");
  assert.equal(props.grade, "action_proof");
  assert.equal(props.day, 1);
});

test("★no raw/PII data leaks: caller-supplied raw keys never appear in the props", () => {
  const props = buildFunnelEventProps({
    stage: "evidence_ingested", attemptId: "att_1",
    // All of these are raw/PII and must NOT survive (the builder is allowlist-only).
    bytes: "AAAA", bytesBase64: "AAAA", ref: "artifact://x", receipt: "v3.tok", receiptToken: "v3.tok",
    note: "secret note", candidate: "조은성", evidenceLocation: "스크린샷", email: "x@y.com",
    customerText: "고객이 한 말",
  });
  const keys = Object.keys(props);
  for (const forbidden of ["bytes", "bytesBase64", "ref", "receipt", "receiptToken", "note", "candidate", "evidenceLocation", "email", "customerText"]) {
    assert.ok(!keys.includes(forbidden), `funnel props must not include raw key "${forbidden}"`);
  }
  // It still carries the safe join key.
  assert.equal(props.attemptId, "att_1");
});

test("emitOfficeHoursFunnelEvent calls telemetry with the mapped event name + built props", () => {
  const calls = [];
  const telemetry = { captureEvent: (name, props) => calls.push({ name, props }) };
  emitOfficeHoursFunnelEvent(telemetry, "action_proof_landed", { attemptId: "att_1", trustTier: "artifact_backed" }, { AGENTIC30_METRIC_EPOCH: "production" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, OFFICE_HOURS_FUNNEL_EVENTS.action_proof_landed);
  assert.equal(calls[0].props.metricEpoch, "production");
  assert.equal(calls[0].props.funnelStage, "action_proof_landed");
  assert.equal(calls[0].props.attemptId, "att_1");
});

test("emitOfficeHoursFunnelEvent throws on an unknown stage; no-ops when telemetry is absent", () => {
  assert.throws(() => emitOfficeHoursFunnelEvent({ captureEvent() {} }, "not_a_stage", {}));
  assert.doesNotThrow(() => emitOfficeHoursFunnelEvent(null, "action_proof_landed", {}));
  assert.doesNotThrow(() => emitOfficeHoursFunnelEvent({}, "action_proof_landed", {}));
});

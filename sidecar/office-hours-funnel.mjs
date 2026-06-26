// office-hours-funnel.mjs — the authoritative Office Hours outcome-capture funnel
// (A′ step 4). Emits VERSIONED DOMAIN events so the p_action / p_learning / t_action
// vectors can be computed downstream in PostHog. This is the "instrumented" half of the
// "instrumented execution system".
//
// ★Two load-bearing rules (GPT-5.5 Pro A′ funnel spec):
//   1. NO RAW DATA. The funnel only ever carries a join key (attemptId), the funnel
//      stage, the host-derived grade/trust-tier/evidence-class, and timestamps. It NEVER
//      carries bytes, a receipt token, a ref/locator, a note, candidate text, an email,
//      or any customer message — those stay out of PostHog entirely. The prop builder is
//      ALLOWLIST-only: it constructs a fixed set of fields, so a raw value cannot ride along.
//   2. metric_epoch SEPARATION. Synthetic eval-arc runs stamp metricEpoch="eval" (via the
//      AGENTIC30_METRIC_EPOCH env) so they can NEVER pollute the real production N. Default
//      is "production". This is the reason the funnel is worth wiring even at N=0: the day
//      a real founder action lands, it is distinguishable from every synthetic eval event.
//
// PURE: buildFunnelEventProps is a pure function of its inputs + env; emission is a thin
// wrapper over the injected telemetry. No I/O of its own.

export const OFFICE_HOURS_FUNNEL_PROTOCOL = 1;
export const METRIC_EPOCHS = Object.freeze(["production", "eval"]);

// Authoritative funnel stages → PostHog event names. The denominator
// (commitment_scheduled) and the numerators (action/customer/goal proof) let PostHog
// compute: p_action = action_proof_landed / commitment_scheduled (per epoch),
// p_learning = customer_outcome_landed / action_proof_landed, t_action = time from
// commitment_scheduled → action_proof_landed.
export const OFFICE_HOURS_FUNNEL_EVENTS = Object.freeze({
  commitment_scheduled: "oh_funnel_commitment_scheduled",       // an eligible Day-1 commitment exists (denominator)
  evidence_ingested: "oh_funnel_evidence_ingested",             // a capture was acquired (host-signed receipt minted)
  action_proof_landed: "oh_funnel_action_proof_landed",         // a backed outbound action committed (p_action numerator)
  customer_outcome_landed: "oh_funnel_customer_outcome_landed", // a confirmed customer reaction committed (p_learning)
  goal_proof_landed: "oh_funnel_goal_proof_landed",             // the goal behavior committed
});

// Graded reducer transition → the funnel stage its successful commit represents. Only
// the proof-landing transitions map; expire_no_response / abandon_attempt carry no proof.
export const TRANSITION_TO_FUNNEL_STAGE = Object.freeze({
  record_action_proof: "action_proof_landed",
  record_customer_outcome: "customer_outcome_landed",
  record_negative_outcome: "customer_outcome_landed", // a confirmed negative reaction is still a customer outcome
  record_goal_proof: "goal_proof_landed",
});

export function resolveMetricEpoch(env = process.env) {
  const raw = String(env?.AGENTIC30_METRIC_EPOCH || "").trim().toLowerCase();
  return METRIC_EPOCHS.includes(raw) ? raw : "production";
}

/**
 * Build the PostHog props for a funnel event. ALLOWLIST-ONLY — it reads a fixed set of
 * non-raw fields and constructs exactly those, so no caller-supplied raw/PII value can
 * leak through. Always stamps funnelProtocol + metricEpoch + funnelStage.
 */
export function buildFunnelEventProps({
  stage,
  attemptId,
  transition,
  trustTier,
  grade,
  evidenceClass,
  detectedMediaType,
  occurredAt,
  day,
  hostTemplateVersion,
  generatorVersion,
} = {}, env = process.env) {
  return {
    funnelProtocol: OFFICE_HOURS_FUNNEL_PROTOCOL,
    metricEpoch: resolveMetricEpoch(env),
    funnelStage: String(stage || ""),
    attemptId: String(attemptId || ""),
    transition: String(transition || ""),
    trustTier: String(trustTier || ""),
    grade: String(grade || ""),
    evidenceClass: String(evidenceClass || ""),
    detectedMediaType: String(detectedMediaType || ""),
    occurredAt: String(occurredAt || ""),
    day: Number.isInteger(day) ? day : null,
    hostTemplateVersion: String(hostTemplateVersion || ""),
    generatorVersion: String(generatorVersion || ""),
  };
}

/**
 * Emit a funnel event through the injected telemetry. `eventKey` must be a known stage.
 * Fail-closed on an unknown stage (a typo'd funnel event is a bug, not a silent no-op);
 * a missing telemetry surface is a graceful no-op (telemetry is optional infra).
 */
export function emitOfficeHoursFunnelEvent(telemetry, eventKey, fields = {}, env = process.env) {
  const name = OFFICE_HOURS_FUNNEL_EVENTS[eventKey];
  if (!name) throw new Error(`unknown office-hours funnel event: ${eventKey}`);
  if (!telemetry || typeof telemetry.captureEvent !== "function") return;
  telemetry.captureEvent(name, buildFunnelEventProps({ ...fields, stage: eventKey }, env));
}

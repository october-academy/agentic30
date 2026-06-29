export const EVIDENCE_GRADES = Object.freeze(["action_proof", "customer_outcome", "goal_proof"]);

export const EVIDENCE_KIND_GRADE = Object.freeze({
  dm_sent_screenshot: "action_proof",
  email_sent: "action_proof",
  call_logged: "action_proof",
  shared_url: "action_proof",
  message_log: "action_proof",
  customer_reply: "customer_outcome",
  refusal: "customer_outcome",
  no_response_deadline_passed: "customer_outcome",
  call_note: "customer_outcome",
  drop_off_step: "customer_outcome",
  activation_event: "goal_proof",
  core_flow_completed: "goal_proof",
  payment: "goal_proof",
  contract: "goal_proof",
  repeat_use: "goal_proof",
});

export const REJECTED_EVIDENCE_KINDS = Object.freeze(new Set([
  "self_report",
  "ai_output",
  "draft",
  "demo",
  "plan",
  "intent_only",
]));

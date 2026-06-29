// GOAL regression pins for the gstack-port-v3 effort. Each test maps 1:1 to a
// Success-Criteria "회귀 핀 테스트" line in the GOAL.
import test from "node:test";
import assert from "node:assert/strict";
import { officeHoursEvidenceHasHardEvidence } from "../sidecar/office-hours-evidence-state.mjs";
import { buildOfficeHoursChatSystemPrompt } from "../sidecar/office-hours-chat-prompt.mjs";
import { buildOfficeHoursEffectorContext } from "../sidecar/office-hours-effector-context.mjs";
import { runOfficeHoursSecondOpinion } from "../sidecar/office-hours-effector-host.mjs";

test("PIN (a): self-report alone never satisfies the hard-evidence gate", () => {
  const selfReport = { references: [{ sourceType: "office_hours_turn", nextIntent: "verbal_interest_or_no_evidence" }] };
  assert.equal(officeHoursEvidenceHasHardEvidence(selfReport), false);
  // a status-quo "they pay/time for a current alternative" signal is a problem
  // signal, NOT proof anyone bought THIS — also zero.
  const statusQuo = { references: [{ sourceType: "office_hours_turn", nextIntent: "paid_or_time_current_alternative" }] };
  assert.equal(officeHoursEvidenceHasHardEvidence(statusQuo), false);
  // empty / Day0 session → zero.
  assert.equal(officeHoursEvidenceHasHardEvidence({ references: [] }), false);
  assert.equal(officeHoursEvidenceHasHardEvidence({}), false);
});

test("PIN (b): a Day2+ effector context is read-only background — it adds no structured-input card (C-3)", () => {
  const effectorContext = buildOfficeHoursEffectorContext({
    landscape: ["유사 도구 3개 존재"],
    secondOpinion: { status: "ok", steelman: "s", strongestSignal: "x", wrongPremise: "y", prototype48h: "z" },
    alternatives: ["최소안", "이상안"],
  });
  // The effector block carries the C-3 guard and no card-generation machinery.
  assert.match(effectorContext, /새 structured input 카드나 질문을 만들지 않는다/);
  assert.doesNotMatch(effectorContext, /generation:\s*\{|generation\.signalId|allowFreeText/);

  const day2Context = [
    "DAY2_PLUS_GOAL_DRIVEN_OFFICE_HOURS",
    "Goal lane: get_users / 활성 사용자 100명 모으기",
  ].join("\n");
  const withEffector = buildOfficeHoursChatSystemPrompt("/workspace", { provider: "codex", context: day2Context, effectorContext });
  const withoutEffector = buildOfficeHoursChatSystemPrompt("/workspace", { provider: "codex", context: day2Context });
  // The effector context appears behind its guard.
  assert.match(withEffector, /새 structured input 카드나 질문을 만들지 않는다/);
  assert.match(withEffector, /유사 도구 3개 존재/);
  // It introduces no NEW structured-input signalId — the question-asking surface is
  // identical with and without the effector (effector adds background, not cards).
  const signalIdsOf = (s) => (s.match(/signalId[:`]?\s*`?[a-z_]+/gi) || []).sort();
  assert.deepEqual(signalIdsOf(withEffector), signalIdsOf(withoutEffector));
});

test("PIN (c): the second-opinion subcall runs read-only and never touches session.pendingUserInput (two-writer)", async () => {
  let captured = null;
  const result = await runOfficeHoursSecondOpinion({
    summary: { goalType: "make_money" },
    runProvider: async (args) => { captured = args; args.onTextReplace("{}"); },
  });
  assert.equal(captured.executionMode, "judge_read_only");
  assert.equal(captured.session, undefined);
  assert.equal(captured.pendingUserInput, undefined);
  assert.equal(captured.runtime, undefined);
  assert.equal(captured.onPendingUserInput, undefined);
  // an empty object response fails open, never throws.
  assert.equal(result.status, "unavailable");
});

test("PIN (d): the daily V2 cards stay reducer / proof-ledger bound", () => {
  const context = [
    "DAY2_PLUS_GOAL_DRIVEN_OFFICE_HOURS",
    "AGENTIC30_PROGRAM_V2_DAILY_CARDS",
    "Goal lane: make_money / 첫 매출 달성",
    "DAY2_PLUS_LIVE_DIGEST",
    "BUILD_WITHOUT_CUSTOMER_EVIDENCE: true",
    "Stale customer evidence debt: commitment_14 repeated 2 times",
  ].join("\n");
  const prompt = buildOfficeHoursChatSystemPrompt("/workspace", { provider: "codex", context });
  const st = prompt.indexOf("office_hours_state_transition");
  const wp = prompt.indexOf("office_hours_agent_workpack");
  assert.ok(st !== -1 && wp !== -1 && st < wp, "state_transition card precedes the workpack card");
  // The card contract is bound to the proof ledger and excludes AI output as proof,
  // so a daily card resolves into a reducer/memory event, never a free-floating pass.
  assert.match(prompt, /proofLedgerMapping/);
  assert.match(prompt, /AI output, drafts, workpack completion, code snippets, demos, and self-report are not proof/);
});

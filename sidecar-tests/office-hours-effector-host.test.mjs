import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldRunOfficeHoursSecondOpinion,
  runOfficeHoursSecondOpinion,
  computeOfficeHoursEffectorContext,
  OFFICE_HOURS_SECOND_OPINION_UNAVAILABLE_DEBT,
} from "../sidecar/office-hours-effector-host.mjs";

const okJudge = () => async ({ onTextReplace }) => {
  onTextReplace(JSON.stringify({
    steelman: "강한 버전",
    strongestSignal: "돈을 쓰는 신호",
    wrongPremise: "틀린 전제",
    prototype48h: "봇",
  }));
};

test("cost guardrail: second opinion only on a contested premise", () => {
  assert.equal(shouldRunOfficeHoursSecondOpinion({ context: "평범한 컨텍스트" }), false);
  assert.equal(shouldRunOfficeHoursSecondOpinion({ context: "CONTESTED_PREMISE here" }), true);
  assert.equal(shouldRunOfficeHoursSecondOpinion({ context: "전제 충돌 발생" }), true);
});

test("cost guardrail: at most once per local day and never over budget", () => {
  const context = "CONTESTED_PREMISE";
  assert.equal(shouldRunOfficeHoursSecondOpinion({ context, alreadyRanTodayKey: "2026-06-29", todayKey: "2026-06-29" }), false);
  assert.equal(shouldRunOfficeHoursSecondOpinion({ context, alreadyRanTodayKey: "2026-06-28", todayKey: "2026-06-29" }), true);
  assert.equal(shouldRunOfficeHoursSecondOpinion({ context, budgetExceeded: true }), false);
});

test("runOfficeHoursSecondOpinion uses the read-only judge mode and never touches session state", async () => {
  let captured = null;
  const runProvider = async (args) => {
    captured = args;
    args.onTextReplace(JSON.stringify({ steelman: "x", strongestSignal: "y", wrongPremise: "z", prototype48h: "w" }));
  };
  const result = await runOfficeHoursSecondOpinion({ summary: { goalType: "make_money" }, provider: "claude", runProvider });
  assert.equal(result.status, "ok");
  assert.equal(result.steelman, "x");
  // two-writer guard: the subcall runs as judge_read_only and is passed no session
  // / pendingUserInput / runtime — it can only return a value.
  assert.equal(captured.executionMode, "judge_read_only");
  assert.equal(captured.session, undefined);
  assert.equal(captured.pendingUserInput, undefined);
  assert.equal(captured.runtime, undefined);
});

test("runOfficeHoursSecondOpinion is fail-open (never throws) on provider failure", async () => {
  const runProvider = async () => { throw new Error("quota exceeded"); };
  const result = await runOfficeHoursSecondOpinion({ summary: {}, runProvider });
  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /quota exceeded/);
});

test("computeOfficeHoursEffectorContext skips the second opinion without a contested premise", async () => {
  let providerCalls = 0;
  const runProvider = async () => { providerCalls += 1; };
  const loadSnapshot = async () => ({ cards: [{ title: "유사 도구 A" }, { title: "유사 도구 B" }] });
  const context = await computeOfficeHoursEffectorContext({
    context: "평범", summary: { goalType: "x" }, runProvider, loadSnapshot,
  });
  assert.equal(providerCalls, 0, "no second opinion without a contested premise");
  assert.match(context, /유사 도구 A/);
  assert.doesNotMatch(context, /generation\.signalId|allowFreeText/);
});

test("computeOfficeHoursEffectorContext runs + injects a gated second opinion and records fail-open debt", async () => {
  const loadSnapshot = async () => ({ cards: [] });
  // success path
  const okCtx = await computeOfficeHoursEffectorContext({
    context: "CONTESTED_PREMISE", summary: { goalType: "make_money" }, runProvider: okJudge(), loadSnapshot,
  });
  assert.match(okCtx, /교차 모델 second opinion/);
  assert.match(okCtx, /강한 버전/);

  // failure path → debt recorded, context fails open with the unavailable note
  const debt = [];
  const failCtx = await computeOfficeHoursEffectorContext({
    context: "CONTESTED_PREMISE", summary: { goalType: "make_money" },
    runProvider: async () => { throw new Error("auth required"); },
    loadSnapshot, debtSink: debt,
  });
  assert.match(failCtx, /독립 모델 의견을 받지 못했다/);
  assert.ok(debt.includes(OFFICE_HOURS_SECOND_OPINION_UNAVAILABLE_DEBT));
});

test("computeOfficeHoursEffectorContext is graceful when the landscape snapshot fails", async () => {
  const loadSnapshot = async () => { throw new Error("no cache"); };
  const context = await computeOfficeHoursEffectorContext({ context: "평범", loadSnapshot });
  assert.equal(context, "");
});

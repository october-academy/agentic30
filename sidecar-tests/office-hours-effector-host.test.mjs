import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldRunOfficeHoursSecondOpinion,
  runOfficeHoursSecondOpinion,
  computeOfficeHoursEffectorContext,
  formatOfficeHoursRecorderDayLoopContext,
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
  const loadMemory = async () => ({ cycles: [] });
  const context = await computeOfficeHoursEffectorContext({ context: "평범", loadSnapshot, loadMemory });
  assert.equal(context, "");
});

test("formatOfficeHoursRecorderDayLoopContext summarizes Gate A without raw recorder details", () => {
  const context = formatOfficeHoursRecorderDayLoopContext({
    review: {
      status: { state: "ready", reason: "recorder_rows_available" },
      evidence_inbox: {
        total: 2,
        unresolved_count: 1,
        written_to_ledger_count: 0,
      },
    },
    evidence_build_result: {
      created_count: 1,
      skipped_count: 1,
    },
    next_action: {
      action: {
        action_type: "review_evidence_inbox",
        title: "Review one Evidence Inbox candidate",
        instruction: "Do not leak this raw instruction",
        sourceIds: ["frame:raw-secret"],
        mediaPath: "media/frames/private.png",
      },
      proof_boundary: { proof_accepted_by_next_action: false },
    },
    proof_boundary: { proof_accepted_by_day_loop: false },
  });

  assert.match(context, /Founder Memory Gate A/);
  assert.match(context, /evidence_inbox total=2 unresolved=1 written_to_ledger=0/);
  assert.match(context, /evidence_candidates created=1 skipped=1/);
  assert.match(context, /next_action=review_evidence_inbox: Review one Evidence Inbox candidate/);
  assert.match(context, /recorder context is not proof/);
  assert.doesNotMatch(context, /raw-secret|private\.png|Do not leak/);
});

test("computeOfficeHoursEffectorContext injects provided Gate A recorder context as read-only background", async () => {
  const loadSnapshot = async () => ({ cards: [] });
  const context = await computeOfficeHoursEffectorContext({
    context: "평범",
    loadSnapshot,
    recorderDayLoop: {
      review: {
        status: { state: "ready" },
        evidenceInbox: { total: 1, unresolvedCount: 1, writtenToLedgerCount: 0 },
      },
      evidenceBuildResult: { createdCount: 1, skippedCount: 0 },
      nextAction: {
        action: { actionType: "review_evidence_inbox", title: "Review one candidate" },
        proofBoundary: { proofAcceptedByNextAction: false },
      },
      proofBoundary: { proofAcceptedByDayLoop: false },
    },
  });

  assert.match(context, /읽기 전용 배경/);
  assert.match(context, /Founder Memory Gate A/);
  assert.match(context, /Review one candidate/);
  assert.doesNotMatch(context, /generation\.signalId|allowFreeText|proof_ledger_write/);
});

test("computeOfficeHoursEffectorContext injects the Phase 6 builder-journey close for a returning builder", async () => {
  const loadSnapshot = async () => ({ cards: [] });
  // Realistic ledger shape: success cycles carry lastAssignment and NO note.
  const loadMemory = async () => ({
    cycles: [
      { cycle: 1, outcome: "success", lastAssignment: "오래된 약속", note: "" },
      { cycle: 2, outcome: "success", lastAssignment: "조은성에게 결제 요청 보내기", note: "" },
    ],
    compiledTruth: { text: "구체 사용자 2회 명명" },
  });
  const context = await computeOfficeHoursEffectorContext({ context: "평범", loadSnapshot, loadMemory, isHandoffTurn: true });
  assert.match(context, /Phase 6 builder-journey/);
  // 2 closed cycles -> sessionCount 3 -> welcome_back tier
  assert.match(context, /tier: welcome_back/);
  // lastAssignment comes from the MOST RECENT cycle, not an older one.
  assert.ok(context.includes("조은성에게 결제 요청 보내기"), "surfaces the latest cycle's assignment");
  assert.ok(!context.includes("오래된 약속"), "does not resurface an older cycle's assignment");
  assert.ok(context.includes("luma.com/agentic_garage"), "invites Agentic Garage");
  assert.ok(context.includes("agentic30.app/blog"), "shares the builder blog");
  assert.match(context, /YC, Y Combinator, Garry Tan, ycombinator\.com은 절대 언급하지 않는다/);
  // The close guidance must be gated to the actual end of the interview.
  assert.match(context, /인터뷰가 실제로 끝나 세션을 닫을 때만 적용/);
});

test("builder-journey close never reframes an avoidance confession (cycle.note) as progress", async () => {
  const loadSnapshot = async () => ({ cards: [] });
  // Realistic blocked cycle: the avoidance CONFESSION lives in note; lastAssignment is "".
  const loadMemory = async () => ({
    cycles: [
      { cycle: 1, outcome: "success", lastAssignment: "조은성에게 결제 요청 보내기", note: "" },
      { cycle: 2, outcome: "blocked", lastAssignment: "", note: "청구가 무서워 미팅으로 미뤘다" },
    ],
    compiledTruth: { text: "결제 요청 아직 미발송" },
  });
  const context = await computeOfficeHoursEffectorContext({ context: "평범", loadSnapshot, loadMemory, isHandoffTurn: true });
  // The confession must NEVER surface in the relationship close.
  assert.ok(!context.includes("청구가 무서워"), "cycle.note (a confession) must not leak into builder-journey");
  // The latest cycle is a confession (lastAssignment ""), so an older success commitment
  // must not be resurfaced as the open "last assignment".
  assert.ok(!context.includes("조은성에게 결제 요청 보내기"), "stale older commitment must not resurface");
});

test("builder-journey regular tier draws its trajectory from compiledTruth, not cycle.note", async () => {
  const loadSnapshot = async () => ({ cards: [] });
  // 3 closed cycles -> sessionCount 4 -> regular tier (the only tier that renders a
  // first->latest trajectory). TWO distinct blocked confessions exercise the exact defect
  // path (firstTitle !== lastTitle): the pre-fix mapping would render them as
  // `처음엔 "첫 회피 고백", 지금은 "둘째 회피 고백"`.
  const loadMemory = async () => ({
    cycles: [
      { cycle: 1, outcome: "blocked", lastAssignment: "", note: "첫 회피 고백" },
      { cycle: 2, outcome: "success", lastAssignment: "진짜 커밋", note: "" },
      { cycle: 3, outcome: "blocked", lastAssignment: "", note: "둘째 회피 고백" },
    ],
    compiledTruth: { text: "누적 신호 요약 라인" },
  });
  const context = await computeOfficeHoursEffectorContext({ context: "평범", loadSnapshot, loadMemory, isHandoffTurn: true });
  assert.match(context, /tier: regular/);
  assert.ok(!context.includes("첫 회피 고백"), "regular-tier trajectory must not render cycle.note (confession) as a design title");
  assert.ok(!context.includes("둘째 회피 고백"), "regular-tier trajectory must not render cycle.note (confession) as a design title");
  assert.ok(context.includes("누적 신호 요약 라인"), "regular tier surfaces accumulatedSignals from compiledTruth");
});

test("computeOfficeHoursEffectorContext omits builder-journey for a first-time builder (no closed cycles)", async () => {
  const loadSnapshot = async () => ({ cards: [] });
  const loadMemory = async () => ({ cycles: [], compiledTruth: { text: "" } });
  // isHandoffTurn true so this asserts the no-closed-cycles gate, not the handoff gate.
  const context = await computeOfficeHoursEffectorContext({ context: "평범", loadSnapshot, loadMemory, isHandoffTurn: true });
  assert.equal(context, "");
});

test("computeOfficeHoursEffectorContext stays graceful when memory load throws", async () => {
  const loadSnapshot = async () => ({ cards: [] });
  const loadMemory = async () => { throw new Error("memory unreadable"); };
  const context = await computeOfficeHoursEffectorContext({ context: "평범", loadSnapshot, loadMemory, isHandoffTurn: true });
  assert.equal(context, "");
});

test("computeOfficeHoursEffectorContext omits the Phase 6 close when it is not the handoff turn", async () => {
  const loadSnapshot = async () => ({ cards: [] });
  // Same returning-builder ledger; the only difference is whether this is the handoff turn.
  const loadMemory = async () => ({
    cycles: [
      { cycle: 1, outcome: "success", lastAssignment: "조은성에게 결제 요청 보내기", note: "" },
      { cycle: 2, outcome: "success", lastAssignment: "support lead Slack 알림 만들기", note: "" },
    ],
    compiledTruth: { text: "구체 사용자 2회 명명" },
  });
  const midInterview = await computeOfficeHoursEffectorContext({ context: "평범", loadSnapshot, loadMemory, isHandoffTurn: false });
  assert.ok(!midInterview.includes("Phase 6 builder-journey"), "no Phase 6 close mid-interview");
  const atHandoff = await computeOfficeHoursEffectorContext({ context: "평범", loadSnapshot, loadMemory, isHandoffTurn: true });
  assert.match(atHandoff, /Phase 6 builder-journey/, "the Phase 6 close appears on the handoff turn");
});

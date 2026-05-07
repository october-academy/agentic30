import test from "node:test";
import assert from "node:assert/strict";

import {
  applyUserTurnResponse,
  createInitialMonetizationAskState,
  ensureMonetizationAskState,
  evaluateTurnResponse,
  getCurrentTurn,
  isMonetizationAskComplete,
  MONETIZATION_ASK_RUNTIME_KEY,
  MONETIZATION_ASK_STATE_SCHEMA_VERSION,
  resetMonetizationAskState,
} from "../sidecar/monetization-ask-state.mjs";
import {
  MONETIZATION_ASK_TURNS,
  MONETIZATION_ASK_META,
} from "../sidecar/monetization-ask-prompt.mjs";

/* Deterministic clock for stable timestamps in assertions. */
function makeClock(start = "2026-05-02T09:00:00.000Z") {
  let next = new Date(start).getTime();
  return () => {
    const value = new Date(next);
    next += 1_000; // step 1 second on each call
    return value;
  };
}

/* ----- createInitialMonetizationAskState / ensureMonetizationAskState ----- */

test("createInitialMonetizationAskState starts at the target turn with empty history", () => {
  const now = makeClock();
  const state = createInitialMonetizationAskState({ now });

  assert.equal(state.workflow, MONETIZATION_ASK_META.name);
  assert.equal(state.day, 6);
  assert.equal(state.schemaVersion, MONETIZATION_ASK_STATE_SCHEMA_VERSION);
  assert.equal(state.turn, "target");
  assert.equal(state.startedAt, "2026-05-02T09:00:00.000Z");
  assert.deepEqual(state.turnHistory, []);
  assert.deepEqual(state.capturesAggregate, {});
  assert.equal(state.attemptCount, 0);
  assert.equal(state.lastPushbackReason, null);
  assert.equal(state.completedAt, null);
});

test("MONETIZATION_ASK_RUNTIME_KEY matches the agreed runtime field name", () => {
  // index.mjs persists state at session.runtime.foundation.monetizationAsk
  assert.equal(MONETIZATION_ASK_RUNTIME_KEY, "monetizationAsk");
});

test("ensureMonetizationAskState falls back to initial state for missing/invalid input", () => {
  const now = makeClock();

  assert.equal(ensureMonetizationAskState(null, { now }).turn, "target");
  assert.equal(ensureMonetizationAskState(undefined, { now }).turn, "target");
  assert.equal(ensureMonetizationAskState("garbage", { now }).turn, "target");
  assert.equal(ensureMonetizationAskState({}, { now }).turn, "target");
});

test("ensureMonetizationAskState normalizes a valid persisted shape", () => {
  const persisted = {
    schemaVersion: 1,
    workflow: "monetization-ask",
    day: 6,
    turn: "draft",
    startedAt: "2026-04-30T08:00:00.000Z",
    turnHistory: [{ id: "target", order: 1, transition: "advanced" }],
    capturesAggregate: { target_name: "김유진" },
    attemptCount: 1,
    lastPushbackReason: null,
    completedAt: null,
  };
  const restored = ensureMonetizationAskState(persisted, { now: makeClock() });

  assert.equal(restored.turn, "draft");
  assert.equal(restored.startedAt, "2026-04-30T08:00:00.000Z");
  assert.equal(restored.turnHistory.length, 1);
  assert.equal(restored.capturesAggregate.target_name, "김유진");
  assert.equal(restored.attemptCount, 1);
});

test("ensureMonetizationAskState resets unknown turn id to target", () => {
  const restored = ensureMonetizationAskState(
    { turn: "totally-not-a-turn", capturesAggregate: { foo: "bar" } },
    { now: makeClock() },
  );
  assert.equal(restored.turn, "target");
});

/* --------------------------- evaluateTurnResponse -------------------------- */

test("evaluateTurnResponse: target — named individual + role + why advances", () => {
  const evaluation = evaluateTurnResponse("target", "김유진 대표 — 작년에 같은 워크플로우 자동화 자체구축 시도해봤다고 들었어. 내가 만든 거 가장 잘 쓸 1순위.");

  assert.equal(evaluation.canAdvance, true);
  assert.deepEqual(evaluation.missing, []);
  assert.deepEqual(evaluation.rejects, []);
  assert.equal(evaluation.presence.named_individual_present, true);
  assert.equal(evaluation.presence.role_or_company_present, true);
  assert.equal(evaluation.presence.why_this_person_specific, true);
});

test("evaluateTurnResponse: target — collective noun gets rejected with pushback", () => {
  const evaluation = evaluateTurnResponse("target", "초기 사용자들 중에 관심 있는 사람들한테 물어볼 거야");

  assert.equal(evaluation.canAdvance, false);
  assert.ok(evaluation.rejects.includes("collective_noun_only"));
  assert.match(evaluation.pushback || "", /실제 한 명/);
});

test("evaluateTurnResponse: target — captures override missing text heuristics", () => {
  const evaluation = evaluateTurnResponse(
    "target",
    "yes",
    {
      target_name: "Alex Park",
      target_role: "CTO",
      why_this_person: "지난주 인터뷰에서 비슷한 도구 자체 구축 중이라고 했어",
    },
  );
  assert.equal(evaluation.canAdvance, true);
});

test("evaluateTurnResponse: target — vague persona without a name is rejected", () => {
  const evaluation = evaluateTurnResponse("target", "early adopter 타입 사람한테 보낼 거야");
  assert.equal(evaluation.canAdvance, false);
  assert.ok(evaluation.rejects.includes("vague_persona"));
});

test("evaluateTurnResponse: draft — price + promise + deadline advances", () => {
  const draft =
    "안녕하세요 김 대표님, 워크플로우 자동화 모듈 첫 배포본을 월 49,000원에 제공하려고 해요. " +
    "2주 안에 PoC 환경에 붙여드리고, 결제 의향은 이번 주 금요일까지 알려주세요.";
  const evaluation = evaluateTurnResponse("draft", draft);

  assert.equal(evaluation.canAdvance, true);
  assert.equal(evaluation.presence.explicit_price, true);
  assert.equal(evaluation.presence.explicit_promise, true);
  assert.equal(evaluation.presence.explicit_deadline, true);
});

test("evaluateTurnResponse: draft — interest-check only is rejected", () => {
  const evaluation = evaluateTurnResponse(
    "draft",
    "혹시 이 도구에 관심 있어? 시간 되면 30분 얘기 나누자.",
  );
  assert.equal(evaluation.canAdvance, false);
  assert.ok(evaluation.rejects.includes("interest_check_only"));
  assert.match(evaluation.pushback || "", /가격|약속|기한/);
});

test("evaluateTurnResponse: draft — waitlist signup ask is rejected", () => {
  const evaluation = evaluateTurnResponse(
    "draft",
    "사전 등록 waitlist에 이름 올려줄래? 출시되면 알려줄게.",
  );
  assert.equal(evaluation.canAdvance, false);
  assert.ok(evaluation.rejects.includes("waitlist_signup_ask"));
});

test("evaluateTurnResponse: draft — referral ask is rejected", () => {
  const evaluation = evaluateTurnResponse(
    "draft",
    "혹시 주변에 필요한 사람 있어? 소개해줄 수 있을까?",
  );
  assert.equal(evaluation.canAdvance, false);
  assert.ok(evaluation.rejects.includes("referral_ask"));
});

test("evaluateTurnResponse: draft — bare free trial only is rejected; trial-then-paid OK", () => {
  const trialOnly = evaluateTurnResponse("draft", "무료 체험 한 달 줄게.");
  assert.equal(trialOnly.canAdvance, false);
  assert.ok(trialOnly.rejects.includes("free_trial_only"));

  const paidWithTrial = evaluateTurnResponse(
    "draft",
    "첫 2주 무료 체험 이후 월 99,000원 결제. 이번 주 안에 PoC 결과 받아보고 결제 의향 알려줘.",
  );
  assert.equal(paidWithTrial.canAdvance, true);
});

test("evaluateTurnResponse: draft — captures provide all three pillars", () => {
  const evaluation = evaluateTurnResponse(
    "draft",
    "메시지 본문은 별도 첨부",
    {
      draft_text: "[full draft attached]",
      price_amount: "₩49,000/월",
      promise_delivered: "Workflow auto-sync POC delivered in 14 days",
      response_deadline: "Friday EOD",
    },
  );
  assert.equal(evaluation.canAdvance, true);
});

test("evaluateTurnResponse: sent — timestamp + channel + evidence advances", () => {
  const evaluation = evaluateTurnResponse(
    "sent",
    "오늘 14:32 KST에 이메일로 보냈어. 스크린샷 경로: /workspace/.agentic30/foundation/sent-screenshot.png",
  );
  assert.equal(evaluation.canAdvance, true);
  assert.equal(evaluation.presence.timestamp_present, true);
  assert.equal(evaluation.presence.channel_named, true);
  assert.equal(evaluation.presence.evidence_pointer, true);
});

test("evaluateTurnResponse: sent — vague claim without evidence rejected", () => {
  const evaluation = evaluateTurnResponse("sent", "보냈어");
  assert.equal(evaluation.canAdvance, false);
  // missing all three requires
  assert.ok(evaluation.missing.includes("timestamp_present"));
  assert.ok(evaluation.missing.includes("channel_named"));
  assert.ok(evaluation.missing.includes("evidence_pointer"));
});

test("evaluateTurnResponse: sent — future tense rejected", () => {
  const evaluation = evaluateTurnResponse(
    "sent",
    "이따 보낼 거야, 곧 보낼게. 채널은 슬랙 DM.",
  );
  assert.equal(evaluation.canAdvance, false);
  assert.ok(evaluation.rejects.includes("future_tense"));
});

test("evaluateTurnResponse: response — verbatim quote + classification advances", () => {
  const evaluation = evaluateTurnResponse(
    "response",
    "응답: \"지금은 예산이 없어요. 다음 분기에 다시 얘기하죠.\" — 분류: no. 결제 실행: false.",
  );
  assert.equal(evaluation.canAdvance, true);
});

test("evaluateTurnResponse: response — summary only is rejected", () => {
  const evaluation = evaluateTurnResponse(
    "response",
    "긍정적이었어, 반응이 좋았음.",
  );
  assert.equal(evaluation.canAdvance, false);
  assert.ok(evaluation.rejects.includes("summarized_response"));
});

test("evaluateTurnResponse: response — explicit no_reply counts as classification", () => {
  const evaluation = evaluateTurnResponse(
    "response",
    "no_reply — 24시간 답장 없음.",
    { response_classification: "no_reply" },
  );
  assert.equal(evaluation.canAdvance, true);
  assert.equal(evaluation.presence.classification_present, true);
});

test("evaluateTurnResponse: unknown turn returns generic pushback", () => {
  const evaluation = evaluateTurnResponse("nonexistent", "anything");
  assert.equal(evaluation.canAdvance, false);
  assert.ok(typeof evaluation.pushback === "string");
});

/* ---------------------------- applyUserTurnResponse ----------------------- */

test("applyUserTurnResponse: full happy-path target → draft → sent → response", () => {
  const now = makeClock();
  let state = createInitialMonetizationAskState({ now });

  // Turn 1: target
  let r1 = applyUserTurnResponse(state, {
    userResponse:
      "김유진 대표 — 우리 베타 사용자 1번. 지난달 인터뷰에서 같은 워크플로우 자체 구축 시도하다 포기했다고 함.",
    captures: { target_name: "김유진", target_role: "대표", why_this_person: "베타 1번, 지난달 인터뷰에서 직접 시도 후 포기" },
    now,
  });
  assert.equal(r1.advanced, true);
  assert.equal(r1.isTerminal, false);
  assert.equal(r1.turnIdBefore, "target");
  assert.equal(r1.turnIdAfter, "draft");
  state = r1.state;
  assert.equal(state.turn, "draft");
  assert.equal(state.attemptCount, 0); // resets on entering new turn
  assert.equal(state.turnHistory.length, 1);
  assert.equal(state.turnHistory[0].id, "target");
  assert.equal(state.turnHistory[0].attemptCount, 1);
  assert.equal(state.capturesAggregate.target_name, "김유진");

  // Turn 2: draft
  let r2 = applyUserTurnResponse(state, {
    userResponse:
      "김유진 대표님, 우리 워크플로우 자동화 알파 빌드를 월 79,000원에 제공해드릴게요. " +
      "2주 안에 PoC 셋업까지 끝낼 거고, 결제 의향은 이번 주 금요일까지 회신해주세요.",
    captures: {
      draft_text: "[long draft]",
      price_amount: "₩79,000/월",
      promise_delivered: "PoC + onboarding within 2 weeks",
      response_deadline: "Friday EOD",
    },
    now,
  });
  assert.equal(r2.advanced, true);
  assert.equal(r2.turnIdAfter, "sent");
  state = r2.state;
  assert.equal(state.capturesAggregate.price_amount, "₩79,000/월");

  // Turn 3: sent
  let r3 = applyUserTurnResponse(state, {
    userResponse:
      "오늘 14:32에 이메일로 보냈어. 증거: https://mail.google.com/mail/u/0/#sent/abc123",
    captures: { sent_at: "2026-05-02T14:32:00+09:00", sent_channel: "email", sent_evidence_ref: "https://mail.google.com/mail/u/0/#sent/abc123" },
    now,
  });
  assert.equal(r3.advanced, true);
  assert.equal(r3.turnIdAfter, "response");
  state = r3.state;
  assert.equal(state.capturesAggregate.sent_channel, "email");

  // Turn 4: response (terminal)
  let r4 = applyUserTurnResponse(state, {
    userResponse:
      '응답: "Yes, 결제할게요. 카드 번호 보낼 곳 알려주세요." — 분류: yes',
    captures: { response_verbatim: "Yes, 결제할게요. 카드 번호 보낼 곳 알려주세요.", response_classification: "yes", payment_executed: false },
    now,
  });
  assert.equal(r4.advanced, true);
  assert.equal(r4.isTerminal, true);
  assert.equal(r4.turnIdBefore, "response");
  assert.equal(r4.turnIdAfter, "response"); // terminal — cursor stays
  state = r4.state;
  assert.ok(typeof state.completedAt === "string");
  assert.equal(state.turnHistory.length, 4);
  assert.equal(state.capturesAggregate.response_classification, "yes");
  assert.equal(isMonetizationAskComplete(state), true);
});

test("applyUserTurnResponse: pushback keeps cursor and increments attempts", () => {
  const now = makeClock();
  let state = createInitialMonetizationAskState({ now });

  const first = applyUserTurnResponse(state, {
    userResponse: "초기 사용자들한테 보낼 거야",
    now,
  });
  assert.equal(first.advanced, false);
  assert.equal(first.turnIdAfter, "target"); // cursor did not move
  assert.equal(first.attemptCount, 1);
  assert.ok(first.pushback);
  assert.equal(first.reason, "collective_noun_only");
  state = first.state;
  assert.equal(state.attemptCount, 1);
  assert.equal(state.lastPushbackReason, "collective_noun_only");
  assert.equal(state.turnHistory.length, 0); // no closure on pushback

  const second = applyUserTurnResponse(state, {
    userResponse: "early adopter 타입 사람",
    now,
  });
  assert.equal(second.advanced, false);
  assert.equal(second.attemptCount, 2);
  state = second.state;
  assert.equal(state.attemptCount, 2);

  // Now provide a valid named individual — should advance.
  const third = applyUserTurnResponse(state, {
    userResponse: "박지훈 CTO — 작년 conf에서 만났고, 직접 비슷한 도구 만들다가 그만뒀다고 한 사람.",
    now,
  });
  assert.equal(third.advanced, true);
  assert.equal(third.turnIdBefore, "target");
  assert.equal(third.turnIdAfter, "draft");
  state = third.state;
  assert.equal(state.attemptCount, 0); // reset on new turn
  assert.equal(state.lastPushbackReason, null);
  assert.equal(state.turnHistory[0].attemptCount, 3); // all three attempts logged
});

test("applyUserTurnResponse: terminal state rejects further responses", () => {
  const now = makeClock();
  let state = createInitialMonetizationAskState({ now });

  // Force-march to terminal via captures-only happy path
  const captureGroups = [
    { target_name: "Lee", target_role: "CEO", why_this_person: "지난주 인터뷰에서 직접 시도하다 포기 — 우리 도구 가장 잘 쓸 1순위" },
    { draft_text: "...", price_amount: "₩49,000", promise_delivered: "PoC in 2 weeks", response_deadline: "Friday EOD" },
    { sent_at: "2026-05-02T14:32", sent_channel: "email", sent_evidence_ref: "https://mail/abc" },
    { response_verbatim: "OK, 결제할게요", response_classification: "yes" },
  ];
  for (const captures of captureGroups) {
    const r = applyUserTurnResponse(state, { userResponse: "see captures", captures, now });
    assert.equal(r.advanced, true);
    state = r.state;
  }
  assert.equal(isMonetizationAskComplete(state), true);

  const reject = applyUserTurnResponse(state, { userResponse: "더 추가할게", now });
  assert.equal(reject.advanced, false);
  assert.equal(reject.isTerminal, true);
  assert.equal(reject.reason, "already_complete");
});

test("applyUserTurnResponse: capturesAggregate accumulates across turns", () => {
  const now = makeClock();
  let state = createInitialMonetizationAskState({ now });

  state = applyUserTurnResponse(state, {
    userResponse: "박서연 대표 — 지난주 인터뷰 1번, 같은 도구 자체 시도 중이라고 함",
    captures: { target_name: "박서연", target_role: "대표", why_this_person: "지난주 인터뷰" },
    now,
  }).state;
  state = applyUserTurnResponse(state, {
    userResponse: "월 99,000원 / 2주 PoC / 금요일 EOD",
    captures: { price_amount: "₩99,000/월", promise_delivered: "PoC 2주", response_deadline: "Friday EOD" },
    now,
  }).state;

  assert.equal(state.capturesAggregate.target_name, "박서연");
  assert.equal(state.capturesAggregate.price_amount, "₩99,000/월");
  // earlier captures are not lost
  assert.equal(state.capturesAggregate.why_this_person, "지난주 인터뷰");
});

test("applyUserTurnResponse: long user responses are truncated in storage", () => {
  const now = makeClock();
  const state = createInitialMonetizationAskState({ now });
  const longBody = "박서연 대표 — ".concat("a".repeat(10_000));

  const result = applyUserTurnResponse(state, {
    userResponse: longBody,
    captures: { target_name: "박서연", target_role: "대표", why_this_person: "지난주 인터뷰에서 우리 도구 가장 필요해 보였던 사람" },
    now,
  });
  assert.equal(result.advanced, true);
  assert.ok(result.state.turnHistory[0].userResponse.length <= 4000);
});

test("getCurrentTurn returns the descriptor for the cursor", () => {
  const now = makeClock();
  let state = createInitialMonetizationAskState({ now });
  assert.equal(getCurrentTurn(state).id, "target");

  state = applyUserTurnResponse(state, {
    userResponse: "noop",
    captures: { target_name: "박서연", target_role: "대표", why_this_person: "지난주 인터뷰에서 동일 도구 직접 만들고 있었음" },
    now,
  }).state;
  assert.equal(getCurrentTurn(state).id, "draft");
  assert.equal(getCurrentTurn(state).order, 2);
});

test("resetMonetizationAskState clears turn cursor but preserves startedAt", () => {
  const now = makeClock();
  let state = createInitialMonetizationAskState({ now });
  const originalStartedAt = state.startedAt;

  state = applyUserTurnResponse(state, {
    userResponse: "노이즈",
    captures: { target_name: "박서연", target_role: "대표", why_this_person: "지난주 인터뷰에서 직접 비슷한 거 만들다 포기" },
    now,
  }).state;
  assert.equal(state.turn, "draft");

  const reset = resetMonetizationAskState(state, { now });
  assert.equal(reset.turn, "target");
  assert.deepEqual(reset.turnHistory, []);
  assert.deepEqual(reset.capturesAggregate, {});
  assert.equal(reset.startedAt, originalStartedAt);
});

/* ----------------------------- transition order -------------------------- */

test("MONETIZATION_ASK_TURNS encodes the strict target→draft→sent→response order", () => {
  assert.deepEqual(
    MONETIZATION_ASK_TURNS.map((t) => t.id),
    ["target", "draft", "sent", "response"],
  );
  assert.equal(MONETIZATION_ASK_TURNS[0].transition.next, "draft");
  assert.equal(MONETIZATION_ASK_TURNS[1].transition.next, "sent");
  assert.equal(MONETIZATION_ASK_TURNS[2].transition.next, "response");
  assert.equal(MONETIZATION_ASK_TURNS[3].transition.next, null);
});

test("isMonetizationAskComplete is false until response turn closes", () => {
  const now = makeClock();
  let state = createInitialMonetizationAskState({ now });
  for (const captures of [
    { target_name: "P", target_role: "CEO", why_this_person: "지난주 인터뷰에서 우리가 만든 거 가장 잘 쓸 1순위로 보임" },
    { price_amount: "₩49,000", promise_delivered: "PoC 2주", response_deadline: "Friday EOD" },
    { sent_at: "2026-05-02T14:32", sent_channel: "email", sent_evidence_ref: "https://x" },
  ]) {
    assert.equal(isMonetizationAskComplete(state), false);
    state = applyUserTurnResponse(state, { userResponse: "x", captures, now }).state;
  }
  assert.equal(isMonetizationAskComplete(state), false);
  state = applyUserTurnResponse(state, {
    userResponse: '"네, 결제할게요" — 분류: yes',
    captures: { response_verbatim: "네, 결제할게요", response_classification: "yes" },
    now,
  }).state;
  assert.equal(isMonetizationAskComplete(state), true);
});

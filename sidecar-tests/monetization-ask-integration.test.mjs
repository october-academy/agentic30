/**
 * Sub-AC 4 — monetization-ask sub-workflow integration verification.
 *
 * Scope: the glue between the unified Foundation chat surface and the 4-turn
 * monetization-ask state machine. We do NOT spin up index.mjs / WebSocket
 * here — those layers are exercised by sidecar smoke tests. Instead we lock
 * down the integration module's three contracts that runUnifiedFoundationChat
 * depends on:
 *
 *   1. State plumbing through `session.runtime.foundation.monetizationAsk`
 *      (load → ensure → attach round-trip).
 *   2. The turn-specific systemBlock the dispatcher splices into
 *      `composeUnifiedFoundationPrompt({ bipContextBlock })`.
 *   3. The terminal-turn outcome — `monetization-ask-result.md` is written
 *      to the workspace and an evidence_ref is emitted with the artifact
 *      path so persistEvidenceRefsSidecar() picks up the lineage.
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
  MONETIZATION_ASK_DAY,
  MONETIZATION_ASK_EVIDENCE_REF_TYPE,
  MONETIZATION_ASK_SUB_WORKFLOW,
  applyMonetizationAskOutcome,
  attachMonetizationAskState,
  buildMonetizationAskContextBlock,
  buildMonetizationAskEvidenceRef,
  loadMonetizationAskState,
  shouldRunMonetizationAsk,
} from "../sidecar/monetization-ask-integration.mjs";
import {
  MONETIZATION_ASK_META,
  MONETIZATION_ASK_TURNS,
} from "../sidecar/monetization-ask-prompt.mjs";
import {
  MONETIZATION_ASK_RUNTIME_KEY,
  createInitialMonetizationAskState,
} from "../sidecar/monetization-ask-state.mjs";
import {
  MONETIZATION_ASK_RESULT_FILENAME,
} from "../sidecar/monetization-ask-result.mjs";
import {
  collectFoundationEvidence,
} from "../sidecar/foundation-summary/evidence-collector.mjs";

/** Deterministic clock matching peer test conventions. */
function makeClock(start = "2026-05-02T09:00:00.000Z") {
  let next = new Date(start).getTime();
  return () => {
    const value = new Date(next);
    next += 1_000;
    return value;
  };
}

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "agentic30-monetization-ask-integ-"),
  );
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

/* ─────────────── shouldRunMonetizationAsk gate ─────────────── */

test("shouldRunMonetizationAsk gates on day=6 + sub_workflow=monetization-ask", () => {
  assert.equal(MONETIZATION_ASK_DAY, 6);
  assert.equal(MONETIZATION_ASK_SUB_WORKFLOW, "monetization-ask");

  assert.equal(
    shouldRunMonetizationAsk({ day: 6, subWorkflow: "monetization-ask" }),
    true,
  );
  assert.equal(
    shouldRunMonetizationAsk({ day: 6, subWorkflow: "office-hours-docs" }),
    false,
    "Day 6 with a different sub_workflow must NOT trigger monetization-ask",
  );
  assert.equal(
    shouldRunMonetizationAsk({ day: 5, subWorkflow: "monetization-ask" }),
    false,
    "non-Day-6 must NOT trigger monetization-ask",
  );
  assert.equal(shouldRunMonetizationAsk({}), false);
  assert.equal(shouldRunMonetizationAsk({ day: 6 }), false);
  assert.equal(shouldRunMonetizationAsk({ subWorkflow: "monetization-ask" }), false);
  assert.equal(shouldRunMonetizationAsk({ day: "6", subWorkflow: "monetization-ask" }), true,
    "string day numerics should coerce — Swift host sends number, but tests guard the cast");
});

/* ─────────────── load / attach round-trip ─────────────── */

test("loadMonetizationAskState returns a fresh initial state for empty runtime", () => {
  const now = makeClock();
  const fresh = loadMonetizationAskState(undefined, { now });
  assert.equal(fresh.workflow, MONETIZATION_ASK_META.name);
  assert.equal(fresh.day, 6);
  assert.equal(fresh.turn, "target");
  assert.equal(typeof fresh.startedAt, "string");
  assert.deepEqual(fresh.turnHistory, []);
  assert.deepEqual(fresh.capturesAggregate, {});
  assert.equal(fresh.completedAt, null);
});

test("loadMonetizationAskState pulls from session.runtime.foundation.monetizationAsk", () => {
  const seed = createInitialMonetizationAskState({ now: makeClock() });
  const advanced = { ...seed, turn: "draft" };
  const sessionRuntime = {
    foundation: {
      day: 6,
      sub_workflow: "monetization-ask",
      [MONETIZATION_ASK_RUNTIME_KEY]: advanced,
    },
  };
  const loaded = loadMonetizationAskState(sessionRuntime);
  assert.equal(loaded.turn, "draft", "must surface the persisted cursor, not reset to target");
});

test("attachMonetizationAskState preserves sibling foundation runtime fields", () => {
  const seed = createInitialMonetizationAskState({ now: makeClock() });
  const previousRuntime = {
    codexThreadId: "abc",
    foundation: {
      day: 6,
      sub_workflow: "monetization-ask",
      spec_version: null,
      lastFoundationChatAt: "2026-05-02T09:00:00.000Z",
    },
  };
  const newRuntime = attachMonetizationAskState(previousRuntime, seed);
  assert.equal(newRuntime.codexThreadId, "abc", "non-foundation siblings must survive");
  assert.equal(newRuntime.foundation.day, 6, "foundation siblings must survive");
  assert.equal(newRuntime.foundation.sub_workflow, "monetization-ask");
  assert.equal(newRuntime.foundation.lastFoundationChatAt, "2026-05-02T09:00:00.000Z");
  assert.deepEqual(
    newRuntime.foundation[MONETIZATION_ASK_RUNTIME_KEY],
    seed,
    "monetizationAsk slot must equal the attached state",
  );
});

test("attachMonetizationAskState is pure — never mutates input runtime", () => {
  const previous = { foundation: { day: 6 } };
  const snapshot = JSON.parse(JSON.stringify(previous));
  const seed = createInitialMonetizationAskState({ now: makeClock() });
  attachMonetizationAskState(previous, seed);
  assert.deepEqual(previous, snapshot, "input must remain untouched");
});

/* ─────────────── systemBlock renderer ─────────────── */

test("buildMonetizationAskContextBlock renders the current turn's systemBlock", () => {
  const now = makeClock();
  const state = createInitialMonetizationAskState({ now });
  const block = buildMonetizationAskContextBlock(state);
  assert.ok(block.length > 0);
  assert.match(block, /Sub-workflow: monetization-ask \(Day 6\)/);
  assert.match(block, /현재 턴: 1\/4/, "fresh state should point at turn 1 (target)");
  assert.match(block, /Target/);
});

test("buildMonetizationAskContextBlock returns the next turn's block when state advances", () => {
  const state = {
    ...createInitialMonetizationAskState({ now: makeClock() }),
    turn: "draft",
  };
  const block = buildMonetizationAskContextBlock(state);
  assert.match(block, /현재 턴: 2\/4/);
  assert.match(block, /Draft/);
});

test("buildMonetizationAskContextBlock returns empty string for null/missing state", () => {
  assert.equal(buildMonetizationAskContextBlock(null), "");
  assert.equal(buildMonetizationAskContextBlock(undefined), "");
  assert.equal(buildMonetizationAskContextBlock({}), "");
  assert.equal(buildMonetizationAskContextBlock({ turn: "" }), "");
});

test("buildMonetizationAskContextBlock returns empty string for terminal state", () => {
  // Once the workflow has finalized there is no turn to push the AI toward —
  // the result.md write happens in the outcome path instead.
  const completedState = {
    turn: "response",
    completedAt: "2026-05-03T00:00:00.000Z",
    turnHistory: MONETIZATION_ASK_TURNS.map((t) => ({ id: t.id })),
    capturesAggregate: { response_classification: "yes" },
    startedAt: "2026-05-02T09:00:00.000Z",
    attemptCount: 1,
    lastPushbackReason: null,
  };
  assert.equal(buildMonetizationAskContextBlock(completedState), "");
});

/* ─────────────── evidenceRef shape ─────────────── */

test("buildMonetizationAskEvidenceRef returns null without an artifact path", () => {
  assert.equal(buildMonetizationAskEvidenceRef({ artifactPath: "", state: {} }), null);
  assert.equal(buildMonetizationAskEvidenceRef({ artifactPath: null, state: {} }), null);
});

test("buildMonetizationAskEvidenceRef shape matches sanitizeEvidenceRefs contract", () => {
  // foundation-chat.mjs sanitizeEvidenceRefs accepts:
  //   { file, location, field_used, extracted_value, ref_type }
  const ref = buildMonetizationAskEvidenceRef({
    artifactPath: "/tmp/ws/.agentic30/foundation/monetization-ask-result.md",
    state: {
      capturesAggregate: {
        response_classification: "yes",
        payment_executed: true,
        target_name: "김유진",
      },
      completedAt: "2026-05-03T01:23:45.000Z",
    },
  });
  assert.ok(ref);
  assert.equal(ref.file, "/tmp/ws/.agentic30/foundation/monetization-ask-result.md");
  assert.equal(ref.location, MONETIZATION_ASK_RESULT_FILENAME);
  assert.equal(ref.field_used, "monetization-ask-result");
  assert.equal(ref.ref_type, MONETIZATION_ASK_EVIDENCE_REF_TYPE);
  assert.equal(ref.extracted_value.classification, "yes");
  assert.equal(ref.extracted_value.payment_executed, true);
  assert.equal(ref.extracted_value.target_name, "김유진");
  assert.equal(ref.extracted_value.completed_at, "2026-05-03T01:23:45.000Z");
});

/* ─────────────── outcome — pushback path ─────────────── */

test("applyMonetizationAskOutcome — pushback when user response is too vague", async () => {
  await withTempWorkspace(async (root) => {
    const now = makeClock();
    const state = createInitialMonetizationAskState({ now });
    const outcome = await applyMonetizationAskOutcome({
      state,
      userResponse: "개발자들한테 보낼 거야", // collective noun, no named individual
      workspaceRoot: root,
      now,
    });
    assert.equal(outcome.advanced, false);
    assert.equal(outcome.isTerminal, false);
    assert.equal(outcome.stateAfter.turn, "target", "must NOT advance on vague response");
    assert.ok(outcome.pushback, "pushback message must be present");
    assert.equal(outcome.resultArtifact, null);
    assert.equal(outcome.evidenceRef, null);
    // No artifact written either.
    const exists = await fileExists(
      path.join(root, ".agentic30", "foundation", MONETIZATION_ASK_RESULT_FILENAME),
    );
    assert.equal(exists, false, "result.md must NOT be written until terminal");
  });
});

/* ─────────────── outcome — single advance, mid-workflow ─────────────── */

test("applyMonetizationAskOutcome — advances target → draft without writing result", async () => {
  await withTempWorkspace(async (root) => {
    const now = makeClock();
    const state = createInitialMonetizationAskState({ now });
    const outcome = await applyMonetizationAskOutcome({
      state,
      userResponse:
        "김유진 대표 — 우리 베타 사용자 1번. 지난달 인터뷰에서 같은 워크플로우 자체 구축 시도하다 포기.",
      captures: {
        target_name: "김유진",
        target_role: "대표",
        target_context: "베타 1번",
        why_this_person: "지난달 인터뷰에서 직접 시도 후 포기",
      },
      workspaceRoot: root,
      now,
    });
    assert.equal(outcome.advanced, true);
    assert.equal(outcome.isTerminal, false);
    assert.equal(outcome.stateAfter.turn, "draft", "cursor must move to next turn");
    assert.equal(outcome.resultArtifact, null);
    assert.equal(outcome.evidenceRef, null);
    const exists = await fileExists(
      path.join(root, ".agentic30", "foundation", MONETIZATION_ASK_RESULT_FILENAME),
    );
    assert.equal(exists, false);
  });
});

/* ─────────────── outcome — terminal turn writes result.md + evidenceRef ─────────────── */

/** Drive the state machine through the first 3 turns so we land on `response`
 *  with a partial state ready to terminate on the next call. */
function buildPreTerminalState({ now }) {
  let state = createInitialMonetizationAskState({ now });

  // turn 1: target
  state = applyTurnSimple(state, {
    userResponse:
      "김유진 대표 — 우리 베타 사용자 1번. 지난달 인터뷰에서 같은 워크플로우 자체 구축 시도하다 포기.",
    captures: {
      target_name: "김유진",
      target_role: "대표",
      target_context: "베타 1번",
      why_this_person: "지난달 인터뷰에서 직접 시도 후 포기",
    },
    now,
  });
  assert.equal(state.turn, "draft");

  // turn 2: draft
  state = applyTurnSimple(state, {
    userResponse:
      "김유진 대표님, 첫 배포본 월 79,000원에 제공. 2주 PoC. 금요일 EOD까지 회신 부탁.",
    captures: {
      draft_text: "[full draft]",
      price_amount: "₩79,000/월",
      promise_delivered: "PoC + onboarding within 2 weeks",
      response_deadline: "Friday EOD",
    },
    now,
  });
  assert.equal(state.turn, "sent");

  // turn 3: sent
  state = applyTurnSimple(state, {
    userResponse:
      "오늘 14:32 KST 이메일로 보냈음. 증거: https://mail.google.com/mail/u/0/#sent/abc123",
    captures: {
      sent_at: "2026-05-02T14:32:00+09:00",
      sent_channel: "email",
      sent_evidence_ref: "https://mail.google.com/mail/u/0/#sent/abc123",
    },
    now,
  });
  assert.equal(state.turn, "response", "must be poised on the terminal turn");
  return state;
}

function applyTurnSimple(state, args) {
  // Synchronous shim using applyUserTurnResponse via the integration, but for
  // mid-workflow advances we don't need the artifact write — call directly.
  // We *must* import inside the helper to avoid hoisting issues; instead use
  // applyMonetizationAskOutcome with a non-existent root to suppress the write,
  // but for non-terminal turns the write path is skipped naturally.
  // (Keeping helper sync-friendly by using state machine directly.)
  // eslint-disable-next-line no-unused-expressions
  args; // narrowing for clarity
  // Inline import via top-level — applyUserTurnResponse already public.
  const { applyUserTurnResponse } = stateMachineRef;
  const result = applyUserTurnResponse(state, args);
  return result.state;
}

// Lazy-bound state machine ref so the helper above stays sync.
const stateMachineRef = await import("../sidecar/monetization-ask-state.mjs");

test("applyMonetizationAskOutcome — terminal turn writes result.md and emits evidenceRef", async () => {
  await withTempWorkspace(async (root) => {
    const now = makeClock();
    const preTerminal = buildPreTerminalState({ now });
    const outcome = await applyMonetizationAskOutcome({
      state: preTerminal,
      userResponse: '응답: "결제할게요. 카드 정보 보낼 곳 알려주세요." — 분류: yes',
      captures: {
        response_verbatim: "결제할게요. 카드 정보 보낼 곳 알려주세요.",
        response_classification: "yes",
        payment_executed: true,
      },
      workspaceRoot: root,
      now,
    });

    assert.equal(outcome.advanced, true);
    assert.equal(outcome.isTerminal, true);
    assert.equal(outcome.stateAfter.completedAt !== null, true);

    // result.md path must match FOUNDATION_DAYS[6].artifacts[0].
    const expectedPath = path.join(
      root,
      ".agentic30",
      "foundation",
      MONETIZATION_ASK_RESULT_FILENAME,
    );
    assert.ok(outcome.resultArtifact);
    assert.equal(outcome.resultArtifact.path, expectedPath);

    const onDisk = await fs.readFile(expectedPath, "utf8");
    assert.match(onDisk, /response_classification:\s*yes/);
    assert.match(onDisk, /payment_executed:\s*true/);
    assert.match(onDisk, /target_name:\s*김유진/);

    // evidence_ref must connect back to the artifact.
    assert.ok(outcome.evidenceRef);
    assert.equal(outcome.evidenceRef.file, expectedPath);
    assert.equal(outcome.evidenceRef.field_used, "monetization-ask-result");
    assert.equal(outcome.evidenceRef.ref_type, MONETIZATION_ASK_EVIDENCE_REF_TYPE);
    assert.equal(outcome.evidenceRef.extracted_value.classification, "yes");
    assert.equal(outcome.evidenceRef.extracted_value.payment_executed, true);
  });
});

test("applyMonetizationAskOutcome — terminal artifact roundtrips through evidence-collector", async () => {
  await withTempWorkspace(async (root) => {
    const now = makeClock();
    const preTerminal = buildPreTerminalState({ now });
    await applyMonetizationAskOutcome({
      state: preTerminal,
      userResponse: '응답: "결제할게요." — 분류: yes',
      captures: {
        response_verbatim: "결제할게요.",
        response_classification: "yes",
        payment_executed: true,
      },
      workspaceRoot: root,
      now,
    });
    const evidence = await collectFoundationEvidence({ workspaceRoot: root });
    assert.equal(evidence.monetization_ask.present, true);
    assert.equal(evidence.monetization_ask.classification, "yes");
    assert.equal(evidence.monetization_ask.response_yes_count, 1);
    assert.equal(evidence.monetization_ask.payment_executed, true);
    assert.equal(evidence.monetization_signal, "yes");
    assert.equal(evidence.go_no_go_recommendation, "continue");
  });
});

test("applyMonetizationAskOutcome — re-emits evidenceRef on already-completed entry", async () => {
  await withTempWorkspace(async (root) => {
    const now = makeClock();
    // Drive to terminal once.
    const preTerminal = buildPreTerminalState({ now });
    const first = await applyMonetizationAskOutcome({
      state: preTerminal,
      userResponse: '응답: "결제할게요." — 분류: yes',
      captures: {
        response_verbatim: "결제할게요.",
        response_classification: "yes",
        payment_executed: true,
      },
      workspaceRoot: root,
      now,
    });
    assert.equal(first.isTerminal, true);
    assert.ok(first.evidenceRef);

    // Re-enter with the already-complete state — outcome must still surface
    // the artifact pointer so the per-message evidence sidecar carries it.
    const second = await applyMonetizationAskOutcome({
      state: first.stateAfter,
      userResponse: "다시 들어왔어",
      workspaceRoot: root,
      now,
    });
    assert.equal(second.advanced, false);
    assert.equal(second.reason, "already_complete");
    assert.ok(second.resultArtifact);
    assert.equal(second.resultArtifact.path, first.evidenceRef.file);
    assert.ok(second.evidenceRef);
    assert.equal(second.evidenceRef.file, first.evidenceRef.file);
  });
});

test("applyMonetizationAskOutcome — never throws when workspaceRoot is missing", async () => {
  const now = makeClock();
  const preTerminal = buildPreTerminalState({ now });
  // No workspaceRoot — terminal path SHOULD NOT throw, just skip the write.
  const outcome = await applyMonetizationAskOutcome({
    state: preTerminal,
    userResponse: '응답: "결제할게요." — 분류: yes',
    captures: {
      response_verbatim: "결제할게요.",
      response_classification: "yes",
      payment_executed: true,
    },
    workspaceRoot: "",
    now,
  });
  assert.equal(outcome.advanced, true);
  assert.equal(outcome.isTerminal, true);
  assert.equal(outcome.resultArtifact, null);
  assert.equal(outcome.evidenceRef, null);
});

/* ─────────────── helpers ─────────────── */

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

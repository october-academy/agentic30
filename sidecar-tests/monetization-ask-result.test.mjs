import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
  applyUserTurnResponse,
  createInitialMonetizationAskState,
} from "../sidecar/monetization-ask-state.mjs";
import {
  MONETIZATION_ASK_META,
  MONETIZATION_ASK_TURNS,
} from "../sidecar/monetization-ask-prompt.mjs";
import {
  MONETIZATION_ASK_RESULT_FILENAME,
  MONETIZATION_ASK_RESULT_SCHEMA_VERSION,
  renderMonetizationAskResultMarkdown,
  writeMonetizationAskResult,
} from "../sidecar/monetization-ask-result.mjs";
import {
  collectFoundationEvidence,
} from "../sidecar/foundation-summary/evidence-collector.mjs";

/** Deterministic clock matching the state-machine test convention. */
function makeClock(start = "2026-05-02T09:00:00.000Z") {
  let next = new Date(start).getTime();
  return () => {
    const value = new Date(next);
    next += 1_000;
    return value;
  };
}

/** Drive the state machine through all 4 turns with realistic captures.
 *  Returns a TERMINAL state (response_classification: yes, payment_executed: false). */
function buildCompletedState({ classification = "yes", paymentExecuted = false } = {}) {
  const now = makeClock();
  let state = createInitialMonetizationAskState({ now });
  const groups = [
    {
      userResponse:
        "김유진 대표 — 우리 베타 사용자 1번. 지난달 인터뷰에서 같은 워크플로우 자체 구축 시도하다 포기.",
      captures: {
        target_name: "김유진",
        target_role: "대표",
        target_context: "베타 1번",
        why_this_person: "지난달 인터뷰에서 직접 시도 후 포기",
      },
    },
    {
      userResponse:
        "김유진 대표님, 첫 배포본 월 79,000원에 제공. 2주 PoC. 금요일 EOD까지 회신 부탁.",
      captures: {
        draft_text: "[full draft]",
        price_amount: "₩79,000/월",
        promise_delivered: "PoC + onboarding within 2 weeks",
        response_deadline: "Friday EOD",
      },
    },
    {
      userResponse:
        "오늘 14:32 KST 이메일로 보냈음. 증거: https://mail.google.com/mail/u/0/#sent/abc123",
      captures: {
        sent_at: "2026-05-02T14:32:00+09:00",
        sent_channel: "email",
        sent_evidence_ref: "https://mail.google.com/mail/u/0/#sent/abc123",
      },
    },
    {
      userResponse: '응답: "결제할게요. 카드 정보 보낼 곳 알려주세요." — 분류: ' + classification,
      captures: {
        response_verbatim: "결제할게요. 카드 정보 보낼 곳 알려주세요.",
        response_classification: classification,
        payment_executed: paymentExecuted,
      },
    },
  ];
  for (const group of groups) {
    state = applyUserTurnResponse(state, { ...group, now }).state;
  }
  return state;
}

/* ─────────────── pure render shape ─────────────── */

test("renderMonetizationAskResultMarkdown returns a non-empty markdown body", () => {
  const state = buildCompletedState();
  const body = renderMonetizationAskResultMarkdown(state, { now: makeClock("2026-05-03T00:00:00.000Z") });
  assert.equal(typeof body, "string");
  assert.ok(body.length > 200, "body should contain a meaningful artifact, not a stub");
  assert.ok(body.startsWith("# monetization-ask 결과 (Day 6)"));
});

test("rendered body advertises the right schema/workflow/day metadata", () => {
  const state = buildCompletedState();
  const body = renderMonetizationAskResultMarkdown(state);
  assert.match(body, /workflow:\s*monetization-ask/);
  assert.match(body, /day:\s*6/);
  assert.match(body, new RegExp(`schema_version:\\s*${MONETIZATION_ASK_RESULT_SCHEMA_VERSION}`));
  assert.match(body, /persona:\s*YC 파트너/);
  assert.match(body, /total_turns:\s*4/);
});

test("rendered body classifies completed runs as status=completed", () => {
  const state = buildCompletedState();
  const body = renderMonetizationAskResultMarkdown(state);
  assert.match(body, /status:\s*completed/);
  assert.match(body, /completed_at:\s*2026-/); // some ISO timestamp
});

test("rendered body marks in-progress runs as status=in_progress", () => {
  const state = createInitialMonetizationAskState({ now: makeClock() });
  const body = renderMonetizationAskResultMarkdown(state);
  assert.match(body, /status:\s*in_progress/);
});

/* ─────────────── classification + payment lines (regex contract) ─────────────── */

test("response_classification line is parseable by evidence-collector regex (yes)", () => {
  const state = buildCompletedState({ classification: "yes", paymentExecuted: true });
  const body = renderMonetizationAskResultMarkdown(state);
  const m = /response[_\s-]*classification\s*[:=]\s*"?(yes|no_reply|maybe|no)"?/i.exec(body);
  assert.ok(m, "classification line must be regex-parseable");
  assert.equal(m[1].toLowerCase(), "yes");
});

test("response_classification line is parseable for no/no_reply/maybe", () => {
  for (const cls of ["no", "no_reply", "maybe"]) {
    const state = buildCompletedState({ classification: cls });
    const body = renderMonetizationAskResultMarkdown(state);
    const m = /response[_\s-]*classification\s*[:=]\s*"?(yes|no_reply|maybe|no)"?/i.exec(body);
    assert.ok(m, `classification=${cls} should match parser regex`);
    assert.equal(m[1].toLowerCase(), cls);
  }
});

test("payment_executed line is parseable as true/false", () => {
  const yesState = buildCompletedState({ paymentExecuted: true });
  const bodyYes = renderMonetizationAskResultMarkdown(yesState);
  const yes = /payment[_\s-]*executed\s*[:=]\s*"?(true|false|yes|no)"?/i.exec(bodyYes);
  assert.ok(yes);
  assert.equal(yes[1].toLowerCase(), "true");

  const noState = buildCompletedState({ paymentExecuted: false });
  const bodyNo = renderMonetizationAskResultMarkdown(noState);
  const no = /payment[_\s-]*executed\s*[:=]\s*"?(true|false|yes|no)"?/i.exec(bodyNo);
  assert.ok(no);
  assert.equal(no[1].toLowerCase(), "false");
});

test("response_yes_count is 1 when classification=yes, 0 otherwise", () => {
  const yesBody = renderMonetizationAskResultMarkdown(buildCompletedState({ classification: "yes" }));
  assert.match(yesBody, /response_yes_count:\s*1/);
  const noBody = renderMonetizationAskResultMarkdown(buildCompletedState({ classification: "no" }));
  assert.match(noBody, /response_yes_count:\s*0/);
  const noReplyBody = renderMonetizationAskResultMarkdown(buildCompletedState({ classification: "no_reply" }));
  assert.match(noReplyBody, /response_yes_count:\s*0/);
});

test("classification line appears BEFORE the verbatim quote so the parser anchors first", () => {
  // The verbatim quote contains the word "yes"; the parser must lock onto the
  // canonical line above, not the user-content quote below it.
  const state = buildCompletedState({ classification: "no" });
  const body = renderMonetizationAskResultMarkdown(state);
  const headerIdx = body.indexOf("response_classification: no");
  const verbatimIdx = body.indexOf("결제할게요");
  assert.ok(headerIdx > -1, "header line missing");
  assert.ok(verbatimIdx > -1, "verbatim quote missing");
  assert.ok(headerIdx < verbatimIdx, "classification header must precede verbatim block");
});

/* ─────────────── 4-turn block coverage ─────────────── */

test("rendered body contains a section for each of the 4 turns", () => {
  const state = buildCompletedState();
  const body = renderMonetizationAskResultMarkdown(state);
  for (const turn of MONETIZATION_ASK_TURNS) {
    const re = new RegExp(`## Turn ${turn.order} — ${escapeRegExp(turn.label)} \\(${turn.id}\\)`);
    assert.match(body, re, `turn ${turn.id} block missing`);
  }
});

test("each closed turn renders captures + verbatim user response", () => {
  const state = buildCompletedState();
  const body = renderMonetizationAskResultMarkdown(state);
  // target — captures rendered
  assert.match(body, /target_name:\s*김유진/);
  assert.match(body, /target_role:\s*대표/);
  assert.match(body, /why_this_person:.*포기/);
  // draft
  assert.match(body, /price_amount:\s*₩79,000/);
  assert.match(body, /response_deadline:\s*Friday EOD/);
  // sent
  assert.match(body, /sent_channel:\s*email/);
  // response
  assert.match(body, /response_classification:\s*yes/);
  // verbatim quote (fenced)
  assert.match(body, /```text[\s\S]*결제할게요[\s\S]*```/);
});

test("captures aggregate JSON block is valid JSON", () => {
  const state = buildCompletedState();
  const body = renderMonetizationAskResultMarkdown(state);
  const m = /```json\n([\s\S]+?)\n```/.exec(body);
  assert.ok(m, "json fenced block missing");
  const parsed = JSON.parse(m[1]);
  assert.equal(parsed.target_name, "김유진");
  assert.equal(parsed.response_classification, "yes");
  assert.equal(parsed.payment_executed, false);
});

/* ─────────────── partial / missing data resilience ─────────────── */

test("renderer prints (미기록) instead of inventing values when state is empty", () => {
  const empty = createInitialMonetizationAskState({ now: makeClock() });
  const body = renderMonetizationAskResultMarkdown(empty);
  assert.match(body, /response_classification:\s*\(미기록\)/);
  assert.match(body, /payment_executed:\s*\(미기록\)/);
  assert.match(body, /completed_at:\s*\(미기록\)/);
});

test("renderer never throws on null/undefined state", () => {
  assert.doesNotThrow(() => renderMonetizationAskResultMarkdown(null));
  assert.doesNotThrow(() => renderMonetizationAskResultMarkdown(undefined));
  assert.doesNotThrow(() => renderMonetizationAskResultMarkdown({}));
});

test("renderer handles malformed turnHistory entries without crashing", () => {
  const state = {
    turn: "draft",
    startedAt: "2026-05-02T09:00:00.000Z",
    completedAt: null,
    turnHistory: [null, undefined, { not: "a real entry" }],
    capturesAggregate: { target_name: "Test" },
    attemptCount: 0,
    lastPushbackReason: null,
  };
  const body = renderMonetizationAskResultMarkdown(state);
  assert.match(body, /target_name:\s*Test/);
});

/* ─────────────── anti-pattern + traceability sections ─────────────── */

test("rendered body lists anti-pattern invariants verbatim", () => {
  const body = renderMonetizationAskResultMarkdown(buildCompletedState());
  assert.match(body, /Anti-pattern check/);
  assert.match(body, /대기 신청자/);
  assert.match(body, /무료 가입/);
  assert.match(body, /원문 그대로/);
  assert.match(body, /실제 이름이 있는 1명/);
});

test("rendered body includes traceability footer with attempt counts", () => {
  const state = buildCompletedState();
  const body = renderMonetizationAskResultMarkdown(state);
  assert.match(body, /## Traceability/);
  assert.match(body, /total_attempts_across_turns:\s*\d+/);
});

/* ─────────────── filesystem write ─────────────── */

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-monetization-result-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("writeMonetizationAskResult creates foundation/<filename> and returns path+body", async () => {
  await withTempWorkspace(async (root) => {
    const state = buildCompletedState();
    const result = await writeMonetizationAskResult({ workspaceRoot: root, state });

    assert.equal(
      result.path,
      path.join(root, ".agentic30", "foundation", MONETIZATION_ASK_RESULT_FILENAME),
    );
    const onDisk = await fs.readFile(result.path, "utf8");
    assert.equal(onDisk, result.body);
    assert.match(onDisk, /response_classification:\s*yes/);
  });
});

test("writeMonetizationAskResult creates parent directory if missing", async () => {
  await withTempWorkspace(async (root) => {
    const state = buildCompletedState();
    // No .agentic30/foundation pre-creation — the writer must mkdir -p.
    const result = await writeMonetizationAskResult({ workspaceRoot: root, state });
    const stat = await fs.stat(result.path);
    assert.ok(stat.isFile());
  });
});

test("writeMonetizationAskResult overwrites a previous run idempotently", async () => {
  await withTempWorkspace(async (root) => {
    const stateA = buildCompletedState({ classification: "no_reply" });
    const a = await writeMonetizationAskResult({ workspaceRoot: root, state: stateA });
    assert.match(a.body, /response_classification:\s*no_reply/);

    const stateB = buildCompletedState({ classification: "yes", paymentExecuted: true });
    const b = await writeMonetizationAskResult({ workspaceRoot: root, state: stateB });
    assert.equal(a.path, b.path);
    const final = await fs.readFile(b.path, "utf8");
    assert.match(final, /response_classification:\s*yes/);
    assert.match(final, /payment_executed:\s*true/);
    assert.doesNotMatch(final, /response_classification:\s*no_reply/);
  });
});

test("writeMonetizationAskResult throws when workspaceRoot is missing", async () => {
  await assert.rejects(
    () => writeMonetizationAskResult({ workspaceRoot: "", state: buildCompletedState() }),
    /workspaceRoot is required/,
  );
});

test("writeMonetizationAskResult uses the canonical filename advertised by FOUNDATION_DAYS[6]", async () => {
  // Cross-check: the file we write must be the same filename
  // foundation-summary/evidence-collector.mjs scans for at the foundation root.
  assert.equal(MONETIZATION_ASK_RESULT_FILENAME, MONETIZATION_ASK_META.artifact);
  assert.equal(MONETIZATION_ASK_META.artifact, "monetization-ask-result.md");
});

/* ─────────────── roundtrip with foundation-summary evidence-collector ─────────────── */

test("evidence-collector reads the rendered artifact back as classification=yes", async () => {
  await withTempWorkspace(async (root) => {
    await writeMonetizationAskResult({
      workspaceRoot: root,
      state: buildCompletedState({ classification: "yes", paymentExecuted: true }),
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

test("evidence-collector reads classification=no result and reports it", async () => {
  await withTempWorkspace(async (root) => {
    await writeMonetizationAskResult({
      workspaceRoot: root,
      state: buildCompletedState({ classification: "no", paymentExecuted: false }),
    });
    const evidence = await collectFoundationEvidence({ workspaceRoot: root });
    assert.equal(evidence.monetization_ask.classification, "no");
    assert.equal(evidence.monetization_ask.response_yes_count, 0);
    assert.equal(evidence.monetization_ask.payment_executed, false);
    assert.equal(evidence.monetization_signal, "no");
  });
});

test("evidence-collector reads classification=no_reply result", async () => {
  await withTempWorkspace(async (root) => {
    await writeMonetizationAskResult({
      workspaceRoot: root,
      state: buildCompletedState({ classification: "no_reply" }),
    });
    const evidence = await collectFoundationEvidence({ workspaceRoot: root });
    assert.equal(evidence.monetization_ask.classification, "no_reply");
    assert.equal(evidence.monetization_signal, "no_reply");
  });
});

/* ─────────────── helpers ─────────────── */

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

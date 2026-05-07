import test from "node:test";
import assert from "node:assert/strict";
import {
  extractInlineDecision,
  inferInlineDecisionFromPlainText,
  INLINE_DECISION_CONTRACT,
  INLINE_DECISION_SENTINEL_END,
  INLINE_DECISION_SENTINEL_START,
  validateInlineDecision,
} from "../sidecar/inline-decision.mjs";

const silentLogger = { warn: () => {} };

const validPayload = {
  header: "전략 문서 용도",
  question: "전략 문서의 용도는 무엇인가요?",
  options: [
    { label: "내부 의사결정용 요약본", description: "팀 내부 결정에 빠르게 참고할 압축본" },
    { label: "외부 공유/피칭용 전략 문서", description: "투자자, 파트너, 채용 후보에게" },
    { label: "ICP/GOAL/VALUES/SPEC 마스터 문서", description: "기존 4개 문서를 하나로" },
  ],
  multiSelect: false,
  allowFreeText: false,
  textMode: "short",
};

test("validateInlineDecision accepts a fully populated payload", () => {
  const result = validateInlineDecision(validPayload, { logger: silentLogger });
  assert.ok(result, "valid payload should be accepted");
  assert.equal(result.question, validPayload.question);
  assert.equal(result.options.length, 3);
  assert.equal(result.multiSelect, false);
  assert.equal(result.allowFreeText, false);
  assert.equal(result.textMode, "short");
});

test("validateInlineDecision normalizes optional fields to defaults", () => {
  const result = validateInlineDecision(
    { question: "Pick one", options: [{ label: "A" }] },
    { logger: silentLogger },
  );
  assert.ok(result);
  assert.equal(result.header, "");
  assert.equal(result.helperText, null);
  assert.equal(result.multiSelect, false);
  assert.equal(result.allowFreeText, false);
  assert.equal(result.freeTextPlaceholder, null);
  assert.equal(result.textMode, "short");
  assert.equal(result.options[0].label, "A");
  assert.equal(result.options[0].description, "");
});

test("validateInlineDecision drops payloads with missing question", () => {
  const calls = [];
  const logger = { warn: (msg) => calls.push(msg) };
  assert.equal(validateInlineDecision(null, { logger }), null);
  assert.equal(validateInlineDecision({}, { logger }), null);
  assert.equal(validateInlineDecision({ question: "  " }, { logger }), null);
  // null/undefined inputs shouldn't log (no payload to drop), but missing
  // question should.
  assert.ok(calls.some((m) => /missing question/.test(m)));
});

test("validateInlineDecision drops payloads with no options and no free text", () => {
  const calls = [];
  const logger = { warn: (msg) => calls.push(msg) };
  const result = validateInlineDecision(
    { question: "Pick", options: [], allowFreeText: false },
    { logger },
  );
  assert.equal(result, null);
  assert.ok(calls.some((m) => /no options and allowFreeText=false/.test(m)));
});

test("validateInlineDecision allows free-text-only payloads (no options)", () => {
  const result = validateInlineDecision(
    {
      question: "직접 입력해 주세요",
      options: [],
      allowFreeText: true,
      freeTextPlaceholder: "여기에 입력",
      textMode: "long",
    },
    { logger: silentLogger },
  );
  assert.ok(result);
  assert.equal(result.options, null);
  assert.equal(result.allowFreeText, true);
  assert.equal(result.freeTextPlaceholder, "여기에 입력");
  assert.equal(result.textMode, "long");
});

test("validateInlineDecision filters malformed option entries", () => {
  const result = validateInlineDecision(
    {
      question: "Pick one",
      options: [
        { label: "A", description: "alpha" },
        null,
        { label: "" },
        { description: "no label" },
        { label: "  B  " },
      ],
    },
    { logger: silentLogger },
  );
  assert.ok(result);
  assert.equal(result.options.length, 2);
  assert.equal(result.options[0].label, "A");
  assert.equal(result.options[1].label, "B");
});

test("validateInlineDecision normalizes multiSelect/allowFreeText to strict booleans", () => {
  const result = validateInlineDecision(
    {
      question: "Q",
      options: [{ label: "A" }],
      multiSelect: "yes",
      allowFreeText: 1,
    },
    { logger: silentLogger },
  );
  assert.ok(result);
  assert.equal(result.multiSelect, false);
  assert.equal(result.allowFreeText, false);
});

test("validateInlineDecision preserves preview and nextIntent on options", () => {
  const result = validateInlineDecision(
    {
      question: "Q",
      options: [{ label: "A", preview: "preview text", nextIntent: "navigate" }],
    },
    { logger: silentLogger },
  );
  assert.ok(result);
  assert.equal(result.options[0].preview, "preview text");
  assert.equal(result.options[0].nextIntent, "navigate");
});

test("INLINE_DECISION_CONTRACT names the inline_decision schema and required fields", () => {
  assert.match(INLINE_DECISION_CONTRACT, /Inline decision contract/);
  assert.match(INLINE_DECISION_CONTRACT, /inline_decision/);
  assert.match(INLINE_DECISION_CONTRACT, /question/);
  assert.match(INLINE_DECISION_CONTRACT, /options/);
  assert.match(INLINE_DECISION_CONTRACT, /multiSelect/);
  assert.match(INLINE_DECISION_CONTRACT, /allowFreeText/);
  assert.match(INLINE_DECISION_CONTRACT, /Mutual exclusion/);
});

test("INLINE_DECISION_CONTRACT instructs against plain-text numbered lists", () => {
  assert.match(INLINE_DECISION_CONTRACT, /번호 리스트/);
  assert.match(INLINE_DECISION_CONTRACT, /예:/);
});

// Regression guard: the inline_decision channel must stay disjoint from the
// form-style ChatSession.pendingUserInput channel (used by office-hours intake
// and bootstrap). validateInlineDecision should reject form-style payloads so
// the two channels never cross-pollinate at the consumer.
test("validateInlineDecision rejects form-style intake payloads (regression)", () => {
  const formStylePayload = {
    requestId: "req-1",
    sessionId: "sess-1",
    toolName: "initial_intake",
    title: "Office Hours intake",
    questions: [
      {
        header: "시작",
        question: "무엇부터 시작할까요?",
        options: [{ label: "프로젝트 전략 문서 만들기", description: "..." }],
      },
    ],
  };
  // The form payload has no top-level `question` field — it's a wrapper.
  // Reject it so callers don't accidentally route a form intake into the
  // inline channel and end up with two cards on the same turn.
  assert.equal(
    validateInlineDecision(formStylePayload, { logger: silentLogger }),
    null,
  );
});

// ── extractInlineDecision: wire-level sentinel parsing ──────────────────

test("extractInlineDecision returns plain text when no sentinel is present", () => {
  const result = extractInlineDecision("Hello, world.", { logger: silentLogger });
  assert.equal(result.text, "Hello, world.");
  assert.equal(result.decision, null);
});

test("extractInlineDecision parses, validates, and strips a well-formed sentinel block", () => {
  const text = `전략 문서의 용도는 무엇인가요?

${INLINE_DECISION_SENTINEL_START}
${JSON.stringify({
    header: "전략 문서 용도",
    question: "전략 문서의 용도는 무엇인가요?",
    options: [
      { label: "내부 의사결정용 요약본", description: "팀 내부용" },
      { label: "외부 공유/피칭용 전략 문서", description: "투자자용" },
    ],
    multiSelect: false,
    allowFreeText: false,
    textMode: "short",
  })}
${INLINE_DECISION_SENTINEL_END}`;
  const result = extractInlineDecision(text, { logger: silentLogger });
  assert.ok(result.decision);
  assert.equal(result.decision.question, "전략 문서의 용도는 무엇인가요?");
  assert.equal(result.decision.options.length, 2);
  // Sentinel block fully removed, leaving only the visible body text.
  assert.equal(result.text, "전략 문서의 용도는 무엇인가요?");
  assert.ok(!result.text.includes(INLINE_DECISION_SENTINEL_START));
  assert.ok(!result.text.includes(INLINE_DECISION_SENTINEL_END));
});

test("extractInlineDecision returns the original text when start delimiter has no matching end (streaming partial)", () => {
  // While streaming, the LLM may have emitted the start sentinel but not
  // yet the closing one. The extractor should leave the text unchanged so
  // the next chunk can complete the block.
  const partial = `질문\n\n${INLINE_DECISION_SENTINEL_START}\n{ "question": "incomplete",`;
  const calls = [];
  const logger = { warn: (msg) => calls.push(msg) };
  const result = extractInlineDecision(partial, { logger });
  assert.equal(result.text, partial);
  assert.equal(result.decision, null);
  assert.ok(calls.some((m) => /sentinel start without matching end/.test(m)));
});

test("extractInlineDecision drops malformed JSON inside the sentinel block", () => {
  const broken = `질문\n\n${INLINE_DECISION_SENTINEL_START}\nthis is not valid json\n${INLINE_DECISION_SENTINEL_END}`;
  const calls = [];
  const logger = { warn: (msg) => calls.push(msg) };
  const result = extractInlineDecision(broken, { logger });
  // Original text returned verbatim so debugging info is preserved
  // upstream — the SwiftUI client renders it as plain text.
  assert.equal(result.text, broken);
  assert.equal(result.decision, null);
  assert.ok(calls.some((m) => /JSON parse failed/.test(m)));
});

test("extractInlineDecision drops payloads that fail validation (e.g. no options + no free text)", () => {
  const invalid = `${INLINE_DECISION_SENTINEL_START}\n${JSON.stringify({
    question: "q",
    options: [],
    allowFreeText: false,
  })}\n${INLINE_DECISION_SENTINEL_END}`;
  const result = extractInlineDecision(invalid, { logger: silentLogger });
  assert.equal(result.decision, null);
});

test("extractInlineDecision handles empty and non-string input gracefully", () => {
  assert.deepEqual(
    extractInlineDecision("", { logger: silentLogger }),
    { text: "", decision: null },
  );
  assert.deepEqual(
    extractInlineDecision(null, { logger: silentLogger }),
    { text: "", decision: null },
  );
  assert.deepEqual(
    extractInlineDecision(undefined, { logger: silentLogger }),
    { text: "", decision: null },
  );
});

test("INLINE_DECISION_CONTRACT documents the sentinel wire format", () => {
  // The contract injected into LLM prompts must explicitly name the sentinel
  // tokens so the model knows where to put the JSON. If this assertion fails
  // because the contract was rewritten, the wire parser will silently miss
  // every payload — keep the tokens in sync.
  assert.match(INLINE_DECISION_CONTRACT, /===INLINE_DECISION===/);
  assert.match(INLINE_DECISION_CONTRACT, /===END===/);
});

test("validateInlineDecision accepts a single StructuredPromptQuestion shape (channel parity)", () => {
  // The inline_decision shape is identical to a single
  // StructuredPromptQuestion entry inside a form payload. This parity is
  // intentional: it lets the SwiftUI client reuse choiceRow/freeTextField for
  // both channels with the same model type. Verify a shape lifted directly
  // from buildBootstrapQuestions() validates cleanly.
  const innerQuestion = {
    header: "시작",
    question: "무엇부터 시작할까요?",
    options: [
      { label: "프로젝트 전략 문서 만들기", description: "..." },
      { label: "아이디어 압박 검증하기", description: "..." },
    ],
    multiSelect: false,
    allowFreeText: false,
    textMode: "short",
  };
  const result = validateInlineDecision(innerQuestion, { logger: silentLogger });
  assert.ok(result);
  assert.equal(result.options.length, 2);
});

test("inferInlineDecisionFromPlainText converts prose example bullets into a decision card", () => {
  const text = "`Threads`에서 초안 작성과 완료 시점에 어떤 형태로 “수동 기록”을 원하는지 한 줄로 정해주면 바로 맞춰드릴 수 있습니다.\n\n예:\n- 로그/메모에 남기기\n- 상태값으로 기록하기\n- 체크리스트 항목으로 표시하기";
  const result = inferInlineDecisionFromPlainText(text, { logger: silentLogger });
  assert.ok(result.decision);
  assert.equal(result.text, "`Threads`에서 초안 작성과 완료 시점에 어떤 형태로 “수동 기록”을 원하는지 한 줄로 정해주면 바로 맞춰드릴 수 있습니다.");
  assert.equal(result.decision.options.length, 3);
  assert.equal(result.decision.options[0].label, "로그/메모에 남기기");
  assert.equal(result.decision.options[1].label, "상태값으로 기록하기");
  assert.equal(result.decision.options[2].label, "체크리스트 항목으로 표시하기");
  assert.equal(result.decision.allowFreeText, true);
});

test("inferInlineDecisionFromPlainText ignores ordinary explanatory bullet lists", () => {
  const text = "오늘 할 일은 아래와 같습니다.\n\n예:\n- README 읽기\n- 테스트 실행\n- 결과 공유";
  const result = inferInlineDecisionFromPlainText(text, { logger: silentLogger });
  assert.equal(result.decision, null);
  assert.equal(result.text, text);
});

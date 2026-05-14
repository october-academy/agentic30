import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_VERIFICATION_METHOD,
  ACTION_VERIFICATION_STATUS,
  createActionDayVerificationState,
  startActionVerification,
} from "../sidecar/action-day-verification-state.mjs";
import {
  parseActionSufficiencyGuideline,
} from "../sidecar/action-sufficiency-guidelines.mjs";
import {
  ACTION_EVIDENCE_JUDGE_EXECUTION_MODE,
  ACTION_EVIDENCE_JUDGE_SCHEMA_VERSION,
  ACTION_EVIDENCE_JUDGE_STATUS,
  buildActionEvidenceJudgePrompt,
  completeActionEvidenceWithJudge,
  judgeActionEvidence,
  parseActionEvidenceJudgeJson,
  runActionEvidenceJudgeProvider,
} from "../sidecar/action-evidence-judge.mjs";

const CURRICULUM_MARKDOWN = `
## Day 6 - Action - Monetization ask
- Goal: 돈/시간 ask를 실행한다.
- Key question: 칭찬이 아니라 명시적 약속을 요청했나?
- Intent: 의향 질문을 실제 응답 데이터로 바꾼다.
- Action ID: day-6-monetization-ask
- Action Type: google_doc
- Action: named target 1명에게 가격, 받을 약속, 응답 기한이 있는 ask를 보낸다.
- Completion signal: monetization-ask-result.md includes target, sent message, deadline, and yes/no/no-reply outcome.
- Verification method: google_docs
- Evidence fallback: link or file
- Sufficiency criteria: Quantity: exactly one named target is recorded; Quality: sent message includes price, promised deliverable, and response deadline; Evidence: yes/no/no-reply outcome is copied verbatim
`;

function makeGuideline() {
  return parseActionSufficiencyGuideline(CURRICULUM_MARKDOWN, {
    day: 6,
    source: "fixture/curriculum.md",
  });
}

function makeClock(start = "2026-05-14T12:00:00.000Z") {
  let next = new Date(start).getTime();
  return () => {
    const value = new Date(next);
    next += 1_000;
    return value;
  };
}

test("buildActionEvidenceJudgePrompt grounds the judge in parsed guideline object and submitted evidence", () => {
  const prompt = buildActionEvidenceJudgePrompt({
    guideline: makeGuideline(),
    evidence: {
      type: "link",
      content: "https://docs.google.com/document/d/proof",
      note: "Ask result doc",
    },
    context: { dayId: 6 },
  });

  assert.match(prompt, /Agentic30 action evidence judge/);
  assert.match(prompt, /Evaluate only the submitted evidence against the parsed curriculum guideline object/);
  assert.match(prompt, /day-6-monetization-ask/);
  assert.match(prompt, /exactly one named target/);
  assert.match(prompt, /https:\/\/docs\.google\.com\/document\/d\/proof/);
  assert.match(prompt, /"dayId": 6/);
});

test("parseActionEvidenceJudgeJson accepts fenced strict JSON from a judge", () => {
  const parsed = parseActionEvidenceJudgeJson(`
\`\`\`json
{
  "status": "accepted",
  "confidence": 0.91,
  "agent_assessment": "The doc records one named target, the exact ask, deadline, and outcome.",
  "criterion_results": [
    { "type": "quantity", "label": "Quantity", "passed": true, "reason": "One named target is present." },
    { "type": "quality", "label": "Quality", "passed": true, "reason": "Price, deliverable, and deadline are visible." },
    { "type": "evidence", "label": "Evidence", "passed": true, "reason": "The yes/no/no-reply outcome is copied verbatim." }
  ],
  "missing_elements": [],
  "mini_action_suggestion": ""
}
\`\`\`
`);

  assert.equal(parsed.status, ACTION_EVIDENCE_JUDGE_STATUS.accepted);
  assert.equal(parsed.confidence, 0.91);
  assert.equal(parsed.agentAssessment, "The doc records one named target, the exact ask, deadline, and outcome.");
  assert.equal(parsed.criterionResults.length, 3);
  assert.deepEqual(parsed.missingElements, []);
});

test("parseActionEvidenceJudgeJson rejects accepted responses with failed required criteria", () => {
  assert.throws(
    () => parseActionEvidenceJudgeJson(JSON.stringify({
      status: "accepted",
      confidence: 0.8,
      agent_assessment: "Looks fine.",
      criterion_results: [
        { type: "quantity", label: "Quantity", passed: false, reason: "No named target found." },
      ],
      missing_elements: [],
    })),
    /Accepted judge response cannot include failed required criteria/,
  );
});

test("judgeActionEvidence evaluates sufficient evidence with a mocked judge response", async () => {
  let capturedPrompt = "";
  const result = await judgeActionEvidence({
    guideline: makeGuideline(),
    evidence: {
      type: "link",
      content: "https://docs.google.com/document/d/day-6-proof",
      note: "Doc includes target, ask, deadline, and no-reply outcome.",
      validationStatus: "valid",
    },
    context: { sessionId: "session-judge-1" },
    now: () => new Date("2026-05-14T12:00:00.000Z"),
    runJudge: async ({ prompt, guideline, evidence }) => {
      capturedPrompt = prompt;
      assert.equal(guideline.actionId, "day-6-monetization-ask");
      assert.equal(evidence.type, "link");
      return JSON.stringify({
        status: "accepted",
        confidence: 0.88,
        agent_assessment: "The submitted doc satisfies the completion signal and all required criteria.",
        criterion_results: [
          { type: "quantity", label: "Quantity", passed: true, reason: "Exactly one named target is recorded." },
          { type: "quality", label: "Quality", passed: true, reason: "Ask includes price, deliverable, and deadline." },
          { type: "evidence", label: "Evidence", passed: true, reason: "Outcome is copied verbatim." },
        ],
        missing_elements: [],
        mini_action_suggestion: "",
      });
    },
  });

  assert.match(capturedPrompt, /completion signal/i);
  assert.equal(result.schemaVersion, ACTION_EVIDENCE_JUDGE_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.action_evidence_judge.v1");
  assert.equal(result.status, ACTION_EVIDENCE_JUDGE_STATUS.accepted);
  assert.equal(result.passed, true);
  assert.equal(result.confidence, 0.88);
  assert.equal(result.guidelineSnapshot.actionId, "day-6-monetization-ask");
  assert.equal(result.evidenceSnapshot.content, "https://docs.google.com/document/d/day-6-proof");
  assert.equal(result.judgedAt, "2026-05-14T12:00:00.000Z");
});

test("judgeActionEvidence returns insufficient with missing elements and mini-action suggestion", async () => {
  const result = await judgeActionEvidence({
    guideline: makeGuideline(),
    evidence: {
      type: "file",
      content: "./evidence/day-6-draft.md",
      note: "Draft ask only.",
    },
    now: () => new Date("2026-05-14T12:10:00.000Z"),
    runJudge: async () => JSON.stringify({
      status: "insufficient",
      confidence: 0.34,
      agent_assessment: "The draft has an ask but no copied customer outcome yet.",
      criterion_results: [
        { type: "quantity", label: "Quantity", passed: true, reason: "One target appears in the draft." },
        { type: "quality", label: "Quality", passed: true, reason: "Price and deadline are present." },
        { type: "evidence", label: "Evidence", passed: false, reason: "No yes/no/no-reply outcome is visible." },
      ],
      missing_elements: ["yes/no/no-reply outcome"],
      mini_action_suggestion: "응답 결과를 문서에 한 줄로 추가해보세요.",
    }),
  });

  assert.equal(result.status, ACTION_EVIDENCE_JUDGE_STATUS.insufficient);
  assert.equal(result.passed, false);
  assert.deepEqual(result.missingElements, ["yes/no/no-reply outcome"]);
  assert.match(result.miniActionSuggestion, /추가해보세요/);
});

test("completeActionEvidenceWithJudge completes a running evidence attempt as passed", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 6,
    actionId: "day-6-monetization-ask",
    actionDescription: "Send one monetization ask.",
    completionSignal: "Doc includes target, sent message, deadline, and outcome.",
    now,
  });
  const running = startActionVerification(pending, {
    method: ACTION_VERIFICATION_METHOD.evidenceLink,
    verifier: "action-evidence-judge",
    evidenceSubmission: {
      type: "link",
      content: "https://docs.google.com/document/d/day-6-proof",
      note: "Submitted fallback evidence.",
      validationStatus: "valid",
    },
    now,
  });

  const result = await completeActionEvidenceWithJudge(running, {
    guideline: makeGuideline(),
    now,
    runJudge: async () => JSON.stringify({
      status: "accepted",
      confidence: 0.9,
      agent_assessment: "The fallback evidence satisfies the action guideline.",
      criterion_results: [
        { type: "quantity", label: "Quantity", passed: true, reason: "One named target is present." },
        { type: "quality", label: "Quality", passed: true, reason: "Required ask details are present." },
        { type: "evidence", label: "Evidence", passed: true, reason: "Outcome is present." },
      ],
      missing_elements: [],
      mini_action_suggestion: "",
    }),
  });

  assert.equal(result.status, ACTION_EVIDENCE_JUDGE_STATUS.accepted);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.passed);
  assert.equal(result.state.verificationResult.passed, true);
  assert.equal(result.state.verificationResult.confidence, 0.9);
  assert.equal(result.state.verificationResult.raw.schema, "agentic30.curriculum.action_evidence_judge.v1");
  assert.equal(result.state.evidenceSubmission.validationStatus, "accepted");
});

test("completeActionEvidenceWithJudge completes insufficient evidence as failed without blocking progression semantics", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 6,
    actionId: "day-6-monetization-ask",
    actionDescription: "Send one monetization ask.",
    completionSignal: "Doc includes target, sent message, deadline, and outcome.",
    now,
  });
  const running = startActionVerification(pending, {
    method: ACTION_VERIFICATION_METHOD.evidenceFile,
    verifier: "action-evidence-judge",
    evidenceSubmission: {
      type: "file",
      content: "./evidence/day-6-draft.md",
      note: "Draft only.",
      validationStatus: "valid",
    },
    now,
  });

  const result = await completeActionEvidenceWithJudge(running, {
    guideline: makeGuideline(),
    now,
    runJudge: async () => JSON.stringify({
      status: "insufficient",
      confidence: 0.25,
      agent_assessment: "The submitted file is relevant but lacks the actual response outcome.",
      criterion_results: [
        { type: "quantity", label: "Quantity", passed: true, reason: "One target exists." },
        { type: "evidence", label: "Evidence", passed: false, reason: "Outcome is missing." },
      ],
      missing_elements: ["response outcome"],
      mini_action_suggestion: "응답 결과를 받은 뒤 yes/no/no-reply를 추가해보세요.",
    }),
  });

  assert.equal(result.status, ACTION_EVIDENCE_JUDGE_STATUS.insufficient);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.failed);
  assert.equal(result.state.verificationResult.passed, false);
  assert.equal(result.state.verificationResult.reason, "Submitted evidence does not satisfy the action guideline.");
  assert.equal(result.state.verificationResult.raw.missingElements[0], "response outcome");
  assert.equal(result.state.evidenceSubmission.validationStatus, "rejected");
});

test("runActionEvidenceJudgeProvider uses the read-only judge execution lane", async () => {
  const output = await runActionEvidenceJudgeProvider({
    prompt: "judge this",
    provider: "codex",
    model: "gpt-test",
    workspaceRoot: "/tmp/agentic30-test",
    runProvider: async ({
      provider,
      model,
      prompt,
      workspaceRoot,
      executionMode,
      onTextDelta,
    }) => {
      assert.equal(provider, "codex");
      assert.equal(model, "gpt-test");
      assert.equal(prompt, "judge this");
      assert.equal(workspaceRoot, "/tmp/agentic30-test");
      assert.equal(executionMode, ACTION_EVIDENCE_JUDGE_EXECUTION_MODE);
      onTextDelta?.("{");
      onTextDelta?.('"status":"accepted"');
      onTextDelta?.("}");
    },
  });

  assert.equal(output, '{"status":"accepted"}');
});

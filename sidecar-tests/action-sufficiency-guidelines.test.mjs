import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_SUFFICIENCY_GUIDELINE_SCHEMA_VERSION,
  parseActionSufficiencyGuideline,
  parseActionSufficiencyGuidelines,
} from "../sidecar/action-sufficiency-guidelines.mjs";

const CURRICULUM_MARKDOWN = `
# Agentic30 Curriculum Minimum Spec

## Day 2 - Action - Market evidence
- Goal: 돈이 흐르는 기준 시장을 고른다.
- Key question: 이미 지불 행동이 있는 가장 가까운 시장은 어디인가?
- Intent: 시장 선택을 의견이 아니라 관찰 가능한 지불 흔적으로 좁힌다.
- Action ID: day-2-market-evidence-log
- Action Type: research_log
- Action: 유료 앱 5개를 찾고 가격, 리뷰, ASO, 광고 흔적을 day-2-evidence-log.md에 기록한다.
- Completion signal: day-2-evidence-log.md contains 5 paid competitors with price, review signal, and acquisition trace.
- Verification method: cli, google_docs
- Evidence fallback: link or file upload accepted
- Dependencies: Day 1 pain quote, SPEC.md v0
- Sufficiency criteria: Quantity: at least 5 paid competitors; Quality: each row has price, review signal, and acquisition trace; Evidence: log link or local file exists

## Day 6 - Action - Ask
- Goal: 돈/시간 ask를 실행한다.
- Key question: 칭찬이 아니라 명시적 약속을 요청했나?
- Intent: 의향 질문을 실제 응답 데이터로 바꾼다.
- Action ID: day-6-monetization-ask
- Action: named target 1명에게 가격, 받을 약속, 응답 기한이 있는 ask를 보낸다.
- Completion signal: monetization-ask-result.md includes target, sent message, deadline, and yes/no/no-reply outcome.
- Verification: google_docs
- Evidence fallback: file

### Action sufficiency
- Quantity: exactly one named target is recorded.
- Quality: sent message includes price, promised deliverable, and response deadline.
- Evidence: yes/no/no-reply outcome is copied verbatim.
`;

test("parseActionSufficiencyGuideline extracts structured criteria for a selected Day action", () => {
  const guideline = parseActionSufficiencyGuideline(CURRICULUM_MARKDOWN, {
    day: 2,
    source: "fixture/curriculum.md",
  });

  assert.equal(guideline.schemaVersion, ACTION_SUFFICIENCY_GUIDELINE_SCHEMA_VERSION);
  assert.equal(guideline.schema, "agentic30.curriculum.action_sufficiency_guideline.v1");
  assert.equal(guideline.dayId, 2);
  assert.equal(guideline.day_id, 2);
  assert.equal(guideline.actionId, "day-2-market-evidence-log");
  assert.equal(guideline.action_id, "day-2-market-evidence-log");
  assert.equal(guideline.actionType, "document");
  assert.match(guideline.goal, /기준 시장/);
  assert.match(guideline.keyQuestion, /지불 행동/);
  assert.match(guideline.intent, /관찰 가능한/);
  assert.match(guideline.actionDescription, /유료 앱 5개/);
  assert.match(guideline.completionSignal, /5 paid competitors/);
  assert.deepEqual(guideline.verificationMethods, ["cli", "google_docs"]);
  assert.deepEqual(guideline.dependencies, ["Day 1 pain quote", "SPEC.md v0"]);
  assert.deepEqual(guideline.evidenceFallback.acceptedTypes, ["link", "file"]);
  assert.deepEqual(guideline.missing, []);

  assert.deepEqual(
    guideline.sufficiencyCriteria.map((criterion) => [criterion.type, criterion.label, criterion.required]),
    [
      ["quantity", "Quantity", true],
      ["quality", "Quality", true],
      ["evidence", "Evidence", true],
    ],
  );
  assert.match(guideline.sufficiencyCriteria[0].description, /at least 5 paid competitors/);
});

test("parseActionSufficiencyGuideline reads bullet criteria from an Action sufficiency section", () => {
  const guideline = parseActionSufficiencyGuideline(CURRICULUM_MARKDOWN, { day: 6 });

  assert.equal(guideline.dayId, 6);
  assert.equal(guideline.actionId, "day-6-monetization-ask");
  assert.equal(guideline.actionType, "document");
  assert.deepEqual(guideline.verificationMethods, ["google_docs"]);
  assert.deepEqual(guideline.evidenceFallback.acceptedTypes, ["file"]);
  assert.equal(guideline.sufficiencyCriteria.length, 3);
  assert.deepEqual(
    guideline.sufficiencyCriteria.map((criterion) => criterion.type),
    ["quantity", "quality", "evidence"],
  );
  assert.match(guideline.sufficiencyCriteria[2].description, /verbatim/);
});

test("parseActionSufficiencyGuideline reads numbered criteria under an empty field label", () => {
  const markdown = `
## Day 9 - Action - Interview proof
- Goal: 인터뷰 약속을 실제 대화로 바꾼다.
- Key question: 고객의 원문을 근거로 남겼나?
- Action: 고객 2명과 통화하고 핵심 원문을 day-9-interviews.md에 정리한다.
- Completion signal: day-9-interviews.md includes two named customer conversations with quotes and follow-up ask.
- Sufficiency criteria:
  1. Quantity: at least 2 named customer conversations are recorded.
  2. Quality: each conversation includes one verbatim pain quote and one follow-up ask.
  3. Evidence: transcript link or local recording summary is attached.
- Verification method: google_docs, browser
`;

  const guideline = parseActionSufficiencyGuideline(markdown, { day: 9 });

  assert.equal(guideline.dayId, 9);
  assert.deepEqual(
    guideline.sufficiencyCriteria.map((criterion) => criterion.type),
    ["quantity", "quality", "evidence"],
  );
  assert.match(guideline.sufficiencyCriteria[0].description, /at least 2 named/);
  assert.match(guideline.sufficiencyCriteria[1].description, /verbatim pain quote/);
  assert.deepEqual(guideline.verificationMethods, ["google_docs", "browser"]);
  assert.deepEqual(guideline.missing, []);
});

test("parseActionSufficiencyGuideline reads checklist and Korean criteria section changes", () => {
  const markdown = `
## Day 12 - Action - Public build log
- 목표: 공개 학습 로그를 남긴다.
- 핵심 질문: 다음 독자가 바로 이해할 만큼 구체적인가?
- Action: 오늘 배운 것과 다음 실험을 포함한 공개 포스트를 작성한다.
- 완료 신호: public-post-url.txt contains the live post URL and a copied post excerpt.
- 검증: browser_tool

### 완료 기준
- [x] 수량: 공개 URL 1개가 저장되어 있다.
- [ ] 품질: 포스트에는 배운 점, 막힌 점, 다음 실험이 모두 들어 있다.
  독자가 맥락 없이 읽어도 이해되어야 한다.
- 증거: URL 또는 스크린샷 파일을 제출할 수 있다.
`;

  const guideline = parseActionSufficiencyGuideline(markdown, { day: 12 });

  assert.equal(guideline.actionType, "public_link");
  assert.deepEqual(
    guideline.sufficiencyCriteria.map((criterion) => [criterion.type, criterion.label]),
    [
      ["quantity", "수량"],
      ["quality", "품질"],
      ["evidence", "증거"],
    ],
  );
  assert.match(guideline.sufficiencyCriteria[1].description, /맥락 없이 읽어도 이해/);
  assert.deepEqual(guideline.verificationMethods, ["browser"]);
  assert.deepEqual(guideline.missing, []);
});

test("parseActionSufficiencyGuidelines can parse all Day action guideline blocks", () => {
  const guidelines = parseActionSufficiencyGuidelines(CURRICULUM_MARKDOWN);

  assert.deepEqual(guidelines.map((guideline) => guideline.dayId), [2, 6]);
  assert.deepEqual(
    guidelines.map((guideline) => guideline.actionId),
    ["day-2-market-evidence-log", "day-6-monetization-ask"],
  );
  assert.ok(guidelines.every((guideline) => guideline.sufficiencyCriteria.length > 0));
});

test("parseActionSufficiencyGuideline returns a structured empty result when day is absent", () => {
  const guideline = parseActionSufficiencyGuideline(CURRICULUM_MARKDOWN, {
    day: 30,
    actionId: "day-30-public-retro",
  });

  assert.equal(guideline.dayId, 30);
  assert.equal(guideline.actionId, "day-30-public-retro");
  assert.equal(guideline.reason, "day_not_found");
  assert.deepEqual(guideline.sufficiencyCriteria, []);
  assert.deepEqual(guideline.missing, [
    "action_description",
    "completion_signal",
    "sufficiency_criteria",
  ]);
});

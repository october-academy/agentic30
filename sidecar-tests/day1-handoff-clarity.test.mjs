import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessDay1HandoffClarity,
  buildDay1HandoffClarityStructuredInput,
  isLowInformationDay1HandoffClarityAnswer,
  mergeDay1HandoffClarityAnswer,
} from "../sidecar/day1-handoff-clarity.mjs";

test("Day 1 handoff clarity gate asks candidate/channel first for vague handoff", () => {
  const assessment = assessDay1HandoffClarity({
    northStarGoal: "첫 고객 반응 검증",
    weeklyProof: "이번 주 3명 인터뷰 완료",
    targetUser: "macOS에서 AI 코딩 도구를 쓰는 전업 1인 개발자",
    problem: "무엇을 팔아야 할지 모른다",
    currentAlternative: "노션과 스프레드시트로 인터뷰 메모를 복사함",
    entryPoint: "첫 인터뷰 카드",
    nextAction: "이번 주 3명 인터뷰 완료",
  });

  assert.equal(assessment.ready, false);
  assert.equal(assessment.nextSlot, "candidate_or_channel");
  assert.equal(assessment.signalId, "day1_clarity_candidate_or_channel");

  const input = buildDay1HandoffClarityStructuredInput({
    toolName: "agentic30_request_user_input",
    assessment,
  });
  assert.equal(input.generation.docType, "day1_handoff_clarity");
  assert.equal(input.generation.signalId, "day1_clarity_candidate_or_channel");
  assert.equal(input.questions[0].allowFreeText, true);
  assert.equal(input.questions[0].requiresFreeText, false);
  assert.equal(input.questions[0].primaryTextInput.required, true);
  assert.equal(input.questions[0].primaryTextInput.label, "후보/채널 한 줄 답변");
  assert.match(input.questions[0].primaryTextInput.validationMessage, /선택만으로는 부족/);
  assert.deepEqual(input.questions[0].options.map((option) => option.label), [
    "지금 답하기",
    "아직 없음 - 아래에 찾을 행동 적기",
  ]);
  assert.doesNotMatch(input.title, /저장 전 근거/);
});

test("Day 1 handoff clarity gate does not repeat same low-information signal", () => {
  const assessment = assessDay1HandoffClarity({
    targetUser: "macOS에서 AI 코딩 도구를 쓰는 전업 1인 개발자",
    currentAlternative: "노션과 스프레드시트로 인터뷰 메모를 복사함",
  }, {
    lastSignalId: "day1_clarity_candidate_or_channel",
    lastAnswerState: "low_information",
  });

  assert.equal(isLowInformationDay1HandoffClarityAnswer("아직 후보 없음"), true);
  assert.equal(assessment.ready, false);
  assert.equal(assessment.nextSlot, "unblock_action");
  assert.equal(assessment.signalId, "day1_clarity_unblock_action");

  const input = buildDay1HandoffClarityStructuredInput({
    toolName: "agentic30_request_user_input",
    assessment,
  });
  assert.equal(input.questions[0].primaryTextInput.required, true);
  assert.equal(input.questions[0].primaryTextInput.label, "오늘 찾을 사람·채널·행동");
  assert.deepEqual(input.questions[0].options.map((option) => option.label), [
    "오늘 찾을 행동 적기",
    "시간·채널부터 적기",
  ]);
  assert.doesNotMatch(input.questions[0].options.map((option) => option.label).join(" "), /아직 없음/);
});

test("Day 1 handoff clarity gate stays on unblock action after low-information unblock answer", () => {
  const assessment = assessDay1HandoffClarity({
    targetUser: "macOS에서 AI 코딩 도구를 쓰는 전업 1인 개발자",
    currentAlternative: "노션과 스프레드시트로 인터뷰 메모를 복사함",
  }, {
    lastSignalId: "day1_clarity_unblock_action",
    lastAnswerState: "low_information",
  });

  assert.equal(assessment.ready, false);
  assert.equal(assessment.nextSlot, "unblock_action");
  assert.equal(assessment.signalId, "day1_clarity_unblock_action");
});

test("Day 1 handoff clarity answer merge makes concrete handoff pass without hard evidence", () => {
  let handoff = {
    northStarGoal: "2026-06-28 18시까지 Threads DM으로 전업 1인 개발자 1명에게 3만원 파일럿 요청을 보낸다.",
    weeklyProof: "내일 18시까지 답변 1건 또는 거절 1건을 캡처한다.",
    targetUser: "macOS에서 AI 코딩 도구를 쓰는 전업 1인 개발자",
    problem: "유료 고객 없이 만든 기능이 실제 구매 요청으로 이어지는지 모른다.",
    currentAlternative: "Notion과 스프레드시트로 후보와 요청 문구를 수동 추적하며 매주 3시간을 잃는다.",
    entryPoint: "3만원 45분 파일럿 제안 DM",
    nextAction: "오늘 18시까지 Threads @solo_maker에게 3만원 파일럿 요청 DM을 보낸다.",
    sourceQuotes: [],
  };

  handoff = mergeDay1HandoffClarityAnswer(handoff, {
    signalId: "day1_clarity_candidate_or_channel",
    responseText: "Threads @solo_maker 채널의 전업 1인 개발자 김OO",
  });
  handoff = mergeDay1HandoffClarityAnswer(handoff, {
    signalId: "day1_clarity_evidence_location_deadline",
    responseText: ".agentic30/evidence/day1-dm.png에 오늘 20시까지 캡처 저장",
  });

  const assessment = assessDay1HandoffClarity(handoff);
  assert.equal(assessment.ready, true);
  assert.deepEqual(assessment.missingSlots, []);
  assert.match(handoff.sourceQuotes.join("\n"), /증거 위치\/기한/);
});

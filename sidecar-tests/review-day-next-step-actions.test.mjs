import test from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_DAY_NEXT_STEP_FALLBACK_SCHEMA_VERSION,
  REVIEW_DAY_NEXT_STEP_ACTIONS_SCHEMA_VERSION,
  formatReviewDayNextStepActionText,
  formatReviewDayNextStepActions,
  resolveReviewDayNextStepFallbackBehavior,
} from "../sidecar/review-day-next-step-actions.mjs";

test("formatReviewDayNextStepActions returns required Review Day action fields", () => {
  const result = formatReviewDayNextStepActions({
    reviewDay: 14,
    dayRange: { start: 8, end: 14 },
    nextDay: 15,
    actionItems: [
      {
        id: "price-ask",
        sourceType: "curriculum",
        title: "가격 ask 실행",
        actionText: "Day 15 전에 가격 ask 문장을 실제 후보 1명에게 보내기",
        completionSignal: "후보 1명의 응답 또는 무응답 캡처",
        verificationMethod: "browser_or_link_evidence",
      },
    ],
    now: new Date("2026-05-14T12:00:00.000Z"),
  });

  assert.equal(result.schemaVersion, REVIEW_DAY_NEXT_STEP_ACTIONS_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.review_day_next_step_actions.v1");
  assert.equal(result.generatedAt, "2026-05-14T12:00:00.000Z");
  assert.equal(result.review_day, 14);
  assert.deepEqual(result.day_range, { start: 8, end: 14 });
  assert.equal(result.next_day, 15);
  assert.equal(result.action_count, 1);
  assert.equal(result.fallback_used, false);

  const [action] = result.actions;
  assert.equal(action.id, "price-ask");
  assert.equal(action.rank, 1);
  assert.equal(action.display_order, 1);
  assert.equal(action.source_type, "curriculum");
  assert.equal(action.review_day, 14);
  assert.deepEqual(action.day_range, { start: 8, end: 14 });
  assert.equal(action.title, "가격 ask 실행");
  assert.equal(action.action_text, "Day 15 전에 가격 ask 문장을 실제 후보 1명에게 보내기");
  assert.equal(action.instruction_text, "Day 15 전에 가격 ask 문장을 실제 후보 1명에게 보내기 해보세요.");
  assert.equal(action.completion_signal, "후보 1명의 응답 또는 무응답 캡처");
  assert.equal(action.verification_method, "browser_or_link_evidence");
  assert.equal(action.non_blocking, true);
  assert.equal(action.cta_text, "10분만 실행해보세요");
  assert.equal(result.user_facing_action_texts[0], action.user_facing_text);
});

test("formatReviewDayNextStepActions orders carry-over and unresolved actions before dashboard suggestions", () => {
  const result = formatReviewDayNextStepActions({
    reviewDay: 21,
    dayRange: { start: 15, end: 21 },
    actionItems: [
      "다음 7일 첫 Action은 가장 강한 고객 근거 하나에 연결하기",
      {
        id: "verify-sheet",
        sourceType: "verification",
        actionText: "Google Sheet 실행 로그의 빈 completion_signal 채우기",
      },
    ],
    unresolvedActions: [
      {
        id: "day-18-proof",
        sourceDay: 18,
        actionDescription: "랜딩 페이지 변경 전후 캡처를 붙이기",
      },
    ],
    carryOverQueue: [
      {
        id: "day-16-interview",
        sourceDay: 16,
        actionDescription: "고객 후보 1명에게 과거 행동 질문 3개 보내기",
        completionSignal: "원문 답변 3개",
        coachingFeedback: "짧게 보내고 답이 없으면 무응답도 증거로 남겨보세요.",
      },
    ],
  });

  assert.deepEqual(
    result.actions.map((action) => [action.id, action.source_type, action.source_day]),
    [
      ["day-16-interview", "carry_over", 16],
      ["day-18-proof", "incomplete_action", 18],
      ["verify-sheet", "verification", null],
      ["dashboard-1", "dashboard", null],
    ],
  );
  assert.deepEqual(result.actions.map((action) => action.rank), [1, 2, 3, 4]);
  assert.ok(result.actions[0].priority > result.actions[1].priority);
  assert.ok(result.actions[1].priority > result.actions[2].priority);
  assert.ok(result.actions[2].priority > result.actions[3].priority);
});

test("formatReviewDayNextStepActions builds user-facing action text with stable structure", () => {
  const result = formatReviewDayNextStepActions({
    reviewDay: 7,
    unresolvedActions: [
      {
        sourceDay: 5,
        actionText: "BIP 공개 글에 배운 점과 다음 실험을 추가",
        completionSignal: "게시글 URL",
        verificationMethod: "browser",
      },
    ],
  });
  const text = result.actions[0].user_facing_text;

  assert.match(text, /^1\. Day 5 미완료 Action 닫기 \| /);
  assert.match(text, /BIP 공개 글에 배운 점과 다음 실험을 추가 해보세요\./);
  assert.match(text, /완료 신호: 게시글 URL/);
  assert.match(text, /확인 방식: browser/);
  assert.match(text, /미완료여도 다음 Day 진행은 막지 않습니다\.$/);
  assert.doesNotMatch(text, /\n/);
  assert.doesNotMatch(text, /\s{2,}/);

  assert.equal(
    formatReviewDayNextStepActionText({
      rank: 2,
      reviewDay: 7,
      sourceType: "workspace",
      title: "GOAL 문서 정리",
      actionText: "GOAL.md에 다음 7일 기준 3줄 쓰기",
      completionSignal: "GOAL.md 저장",
      verificationMethod: "cli",
    }),
    "2. GOAL 문서 정리 | GOAL.md에 다음 7일 기준 3줄 쓰기 해보세요. | 완료 신호: GOAL.md 저장 | 확인 방식: cli | 미완료여도 다음 Day 진행은 막지 않습니다.",
  );
});

test("formatReviewDayNextStepActions provides a non-blocking fallback action", () => {
  const result = formatReviewDayNextStepActions({
    reviewDay: 28,
    now: new Date("2026-05-14T12:30:00.000Z"),
  });

  assert.equal(result.fallback_used, true);
  assert.equal(result.action_count, 1);
  assert.equal(result.actions[0].source_type, "fallback");
  assert.equal(result.actions[0].non_blocking, true);
  assert.match(result.actions[0].user_facing_text, /오늘 Review 질문 1개에 먼저 답하고 다음 Action을 작게 정해보세요\./);
  assert.match(result.actions[0].user_facing_text, /완료 신호: 실행 증거 링크나 파일 1개/);
});

test("resolveReviewDayNextStepFallbackBehavior uses fallback action for empty insights", () => {
  const result = resolveReviewDayNextStepFallbackBehavior({
    reviewDay: 7,
    dayRange: { start: 1, end: 7 },
    nextDay: 8,
    insights: [],
    now: new Date("2026-05-14T13:00:00.000Z"),
  });

  assert.equal(result.schemaVersion, REVIEW_DAY_NEXT_STEP_FALLBACK_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.review_day_next_step_fallback.v1");
  assert.equal(result.generated_at, "2026-05-14T13:00:00.000Z");
  assert.equal(result.fallback_required, true);
  assert.equal(result.fallback_reason, "empty_insights");
  assert.equal(result.insight_health.insight_count, 0);
  assert.equal(result.action_count, 1);
  assert.equal(result.actions[0].source_type, "fallback");
  assert.equal(result.actions[0].non_blocking, true);
  assert.match(result.actions[0].action_text, /미완료 Action 1개/);
  assert.match(result.actions[0].user_facing_text, /다음 Day로 넘어가도 됩니다/);
});

test("resolveReviewDayNextStepFallbackBehavior uses evidence fallback for low-confidence insights", () => {
  const result = resolveReviewDayNextStepFallbackBehavior({
    reviewDay: 14,
    insights: [
      {
        id: "weak-pricing",
        text: "가격 ask 반응이 있을 수도 있습니다.",
        confidence: 0.31,
      },
      {
        id: "weak-string",
        text: "인터뷰 원문 증거가 부족합니다.",
        confidence: "low",
      },
    ],
    minInsightConfidence: 0.6,
  });

  assert.equal(result.fallback_required, true);
  assert.equal(result.fallback_reason, "low_confidence_insights");
  assert.equal(result.insight_health.valid_insight_count, 2);
  assert.equal(result.insight_health.usable_insight_count, 0);
  assert.equal(result.insight_health.low_confidence_insight_count, 2);
  assert.deepEqual(
    result.insight_health.insights.map((insight) => [insight.id, insight.confidence]),
    [
      ["weak-pricing", 0.31],
      ["weak-string", 0.35],
    ],
  );
  assert.match(result.actions[0].action_text, /검증할 수 있는 작은 증거/);
  assert.equal(result.actions[0].verification_method, "evidence_submission");
});

test("resolveReviewDayNextStepFallbackBehavior tolerates malformed insight inputs", () => {
  const result = resolveReviewDayNextStepFallbackBehavior({
    reviewDay: 21,
    insights: [
      null,
      42,
      { id: "missing-text", confidence: 0.9 },
      { summary: "   " },
    ],
  });

  assert.equal(result.fallback_required, true);
  assert.equal(result.fallback_reason, "malformed_insights");
  assert.equal(result.insight_health.insight_count, 4);
  assert.equal(result.insight_health.valid_insight_count, 0);
  assert.equal(result.insight_health.malformed_insight_count, 4);
  assert.match(result.actions[0].action_text, /원자료를 열어 다음 Action 1개/);
  assert.match(result.user_facing_action_texts[0], /미완료여도 다음 Day 진행은 막지 않습니다/);
});

test("resolveReviewDayNextStepFallbackBehavior skips fallback when a usable insight exists", () => {
  const result = resolveReviewDayNextStepFallbackBehavior({
    reviewDay: 28,
    insights: [
      { id: "strong", text: "고객 quote 3개가 가격 ask 다음 행동을 뒷받침합니다.", confidence: "high" },
      { id: "weak", text: "BIP 글 반응은 아직 애매합니다.", confidence: 0.2 },
    ],
  });

  assert.equal(result.fallback_required, false);
  assert.equal(result.fallback_reason, "usable_insights_available");
  assert.equal(result.insight_health.usable_insight_count, 1);
  assert.equal(result.action_count, 0);
  assert.deepEqual(result.actions, []);
});

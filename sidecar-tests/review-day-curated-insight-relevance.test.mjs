import test from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_DAY_CURATED_INSIGHT_RELEVANCE_SCHEMA_VERSION,
  scoreCuratedInsightForNextStep,
  selectCuratedInsightsForNextSteps,
} from "../sidecar/review-day-curated-insight-relevance.mjs";

test("selectCuratedInsightsForNextSteps maps each next step to the most relevant insight text", () => {
  const result = selectCuratedInsightsForNextSteps({
    nextSteps: [
      {
        id: "customer-quotes",
        sourceType: "curriculum",
        sourceDay: 12,
        actionText: "고객 인터뷰 원문 quote 3개를 Google Sheet에 남기기",
        dependencyRefs: ["customer-discovery"],
      },
      {
        id: "price-ask",
        sourceType: "verification",
        sourceDay: 13,
        actionText: "가격 ask 메시지를 후보 1명에게 보내고 응답 증거를 제출하기",
        dependencyRefs: ["pricing-signal"],
      },
    ],
    insights: [
      {
        id: "generic-progress",
        sourceType: "summary",
        text: "Week 2 progress is steady and all Review questions have answers.",
      },
      {
        id: "interview-gap",
        sourceType: "curriculum",
        sourceDay: 12,
        text: "고객 인터뷰는 충분하지만 quote 원문 증거가 아직 부족합니다.",
        dependencyRefs: ["customer-discovery"],
      },
      {
        id: "price-evidence",
        sourceType: "verification",
        sourceDay: 13,
        text: "가격 ask는 보냈지만 후보 응답 evidence 검증이 아직 없습니다.",
        dependencyRefs: ["pricing-signal"],
      },
    ],
  });

  assert.equal(result.schemaVersion, REVIEW_DAY_CURATED_INSIGHT_RELEVANCE_SCHEMA_VERSION);
  assert.equal(result.schema, "agentic30.curriculum.review_day_curated_insight_relevance.v1");
  assert.equal(result.next_step_count, 2);
  assert.equal(result.insight_count, 3);
  assert.deepEqual(
    result.mappings.map((mapping) => [mapping.next_step_id, mapping.top_insight_id]),
    [
      ["customer-quotes", "interview-gap"],
      ["price-ask", "price-evidence"],
    ],
  );
  assert.ok(result.mappings[0].relevance_score > 0);
  assert.ok(result.mappings[0].top_insight.relevance_reasons.includes("same_source_day"));
  assert.ok(result.mappings[0].top_insight.relevance_reasons.includes("dependency_overlap"));
  assert.ok(result.mappings[1].top_insight.relevance_reasons.includes("domain_keyword_overlap"));
});

test("direct action id links beat broadly similar but less grounded insight inputs", () => {
  const result = selectCuratedInsightsForNextSteps({
    maxInsightsPerStep: 2,
    nextSteps: [
      {
        id: "landing-proof",
        actionText: "랜딩 페이지 변경 전후 evidence 링크를 제출하기",
        sourceDay: 18,
      },
    ],
    insights: [
      {
        id: "broad-evidence",
        sourceType: "verification",
        text: "Evidence and proof are important for every next action this week.",
        priority: 20,
      },
      {
        id: "linked-landing",
        sourceType: "workspace",
        text: "랜딩 페이지 변경 기록은 GOAL 문서와 연결되어 있습니다.",
        relatedActionIds: ["landing-proof"],
      },
    ],
  });

  assert.equal(result.mappings[0].top_insight_id, "linked-landing");
  assert.ok(
    result.mappings[0].top_insight.relevance_score
      > result.mappings[0].selected_insights.at(-1).relevance_score,
  );
  assert.ok(result.mappings[0].top_insight.relevance_reasons.includes("direct_action_or_dependency_link"));
});

test("scoreCuratedInsightForNextStep exposes deterministic reasons for day, dependency, and token matches", () => {
  const scoring = scoreCuratedInsightForNextStep({
    nextStep: {
      id: "bip-log",
      sourceDay: 21,
      sourceType: "workspace",
      actionText: "BIP 공개 글에 배운 점과 다음 실험을 기록하기",
      dependencyRefs: ["bip-consistency"],
    },
    insight: {
      id: "bip-insight",
      sourceDay: 21,
      sourceType: "workspace",
      text: "BIP 공개 글은 이어졌지만 다음 실험 기록이 누락되었습니다.",
      dependencyRefs: ["bip-consistency"],
    },
  });

  assert.ok(scoring.score >= 80);
  assert.deepEqual(
    scoring.reasons.filter((reason) => [
      "same_source_day",
      "dependency_overlap",
      "same_source_type",
      "text_token_overlap",
      "domain_keyword_overlap",
    ].includes(reason)),
    [
      "same_source_day",
      "dependency_overlap",
      "same_source_type",
      "text_token_overlap",
      "domain_keyword_overlap",
    ],
  );
});

test("selectCuratedInsightsForNextSteps can retain multiple ranked insight inputs per next step", () => {
  const result = selectCuratedInsightsForNextSteps({
    maxInsightsPerStep: 2,
    nextSteps: [
      {
        id: "carry-over-close",
        sourceType: "curriculum",
        sourceDay: 7,
        actionText: "미완료 carry-over 고객 인터뷰 action을 10분 안에 닫기",
      },
    ],
    insights: [
      {
        id: "carry-over",
        sourceType: "curriculum",
        sourceDay: 7,
        text: "미완료 carry-over action은 고객 인터뷰 증거가 없어서 남아 있습니다.",
      },
      {
        id: "pace",
        sourceType: "coaching",
        text: "빠르게 진행 중이므로 10분 action으로 속도를 낮춰보세요.",
      },
      {
        id: "unrelated",
        sourceType: "summary",
        text: "프로그램 소개를 모두 읽었습니다.",
      },
    ],
  });

  assert.deepEqual(
    result.mappings[0].selected_insights.map((insight) => insight.id),
    ["carry-over", "pace"],
  );
  assert.deepEqual(result.mappings[0].selected_insights.map((insight) => insight.relevance_rank), [1, 2]);
  assert.deepEqual(result.selected_insight_ids, ["carry-over", "pace"]);
});

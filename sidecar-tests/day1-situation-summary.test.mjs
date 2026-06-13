import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DAY1_SITUATION_SUMMARY_SCHEMA_VERSION,
  Day1SituationSummarySchema,
  generateDay1SituationSummary,
  buildDay1SituationSummary,
  composeDay1SituationSummary,
} from "../sidecar/generate-day1-situation-summary.mjs";

const NOW = new Date("2026-05-29T10:00:00Z");
const FORBIDDEN_UNGROUNDED_CHANNEL_RE = /PostHog|UTM|릴스|Meta Ads|Search Console|App Store Ads/;

const baseHypothesis = {
  productName: "EscalationLens",
  projectKind: "web_app",
  targetUser: "B2B CS 리드",
  problem: "Slack 에스컬레이션이 SLA 전에 누락된다",
  purpose: "CS 리드가 위험 티켓을 먼저 보게 한다",
  goal: "이번 주 파일럿 3팀에게 SLA 누락 1건을 줄인다",
  stage: "prototype",
  confidence: "high",
  evidence: ["README.md", ".agentic30/docs/ICP.md"],
};

test("generateDay1SituationSummary emits v3 evidence-ranked shape", () => {
  const summary = generateDay1SituationSummary({
    onboardingHypothesis: baseHypothesis,
    evidenceBuckets: {
      customerEvidence: {
        paths: ["research/cs.md"],
        snippets: ["CS 리드는 현재 Slack thread와 Zendesk dashboard를 매일 직접 확인한다. 파일럿 미팅 2건 예정."],
      },
    },
    now: NOW,
  });

  assert.equal(summary.schemaVersion, DAY1_SITUATION_SUMMARY_SCHEMA_VERSION);
  const parsed = Day1SituationSummarySchema.safeParse(summary);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(summary.project.name, "EscalationLens");
  assert.match(summary.project.customer, /B2B CS/);
  assert.match(summary.diagnosis.bottleneck, /행동|경로|측정|근거|검증/);
  assert.match(summary.baseline.target, /파일럿 3팀/);
  assert.ok(summary.baseline.metrics.some((metric) => /3팀|1건|2건/.test(metric)));
  assert.ok(summary.path.some((node) => node.label === "Slack"));
  assert.ok(summary.path.some((node) => node.label === "Zendesk"));
  assert.ok(summary.actions.length > 0 && summary.actions.length <= 3);
  assert.ok(summary.actions.every((action) => action.evidenceRefs.length > 0 || action.evidenceLimited));
  assert.doesNotMatch(JSON.stringify(summary), /최근\s*\d+개\s*커밋|\d+개\s*파일|핫스팟/);
});

test("CS SaaS evidence does not leak unrelated marketing vendors", () => {
  const summary = generateDay1SituationSummary({
    onboardingHypothesis: baseHypothesis,
    evidenceBuckets: {
      customerEvidence: {
        paths: ["research/cs.md"],
        snippets: ["CS 리드는 Slack thread, Zendesk dashboard, 파일럿 미팅으로 현재 문제를 검증한다."],
      },
    },
    now: NOW,
  });

  assert.doesNotMatch(JSON.stringify(summary.path), FORBIDDEN_UNGROUNDED_CHANNEL_RE);
  assert.doesNotMatch(JSON.stringify(summary.actions), FORBIDDEN_UNGROUNDED_CHANNEL_RE);
});

test("developer tool evidence does not invent consumer acquisition channels", () => {
  const summary = generateDay1SituationSummary({
    onboardingHypothesis: {
      productName: "TraceKit",
      projectKind: "developer_tool",
      targetUser: "OpenTelemetry를 쓰는 플랫폼 엔지니어",
      problem: "분산 trace 비용과 노이즈가 크다",
      purpose: "trace sampling rule을 안전하게 조정한다",
      goal: "팀 2곳에서 noisy endpoint 비용을 20% 줄인다",
      stage: "first_users",
      confidence: "high",
      evidence: ["README.md"],
    },
    evidenceBuckets: {
      workspaceEvidence: {
        evidence: [
          {
            role: "source",
            path: "src/sampler.ts",
            quote: "customer: platform engineer / goal: reduce trace volume by 20% / event: sampling_rule_applied",
            score: 80,
          },
        ],
        signals: {
          productName: "TraceKit",
          targetUser: "OpenTelemetry를 쓰는 플랫폼 엔지니어",
          problem: "분산 trace 비용과 노이즈가 크다",
          goal: "팀 2곳에서 noisy endpoint 비용을 20% 줄인다",
          outcome: "sampling_rule_applied 이벤트를 확인한다",
        },
      },
    },
    now: NOW,
  });

  assert.doesNotMatch(JSON.stringify(summary.path), /릴스|Meta Ads|App Store Ads|Search Console/);
  assert.doesNotMatch(JSON.stringify(summary.actions), /릴스|Meta Ads|App Store Ads|Search Console/);
  assert.match(JSON.stringify(summary), /20%|sampling_rule_applied|TraceKit/);
});

test("empty workspace stays evidence-limited instead of inventing GTM", () => {
  const summary = generateDay1SituationSummary({ onboardingHypothesis: {}, now: NOW });
  const parsed = Day1SituationSummarySchema.safeParse(summary);
  assert.ok(parsed.success);
  assert.equal(summary.schemaVersion, 3);
  assert.equal(summary.qualityGate.passed, false);
  assert.equal(summary.path.length, 0);
  assert.ok(summary.actions.length <= 1);
  assert.ok(summary.actions.every((action) => action.evidenceLimited));
  assert.doesNotMatch(JSON.stringify(summary), FORBIDDEN_UNGROUNDED_CHANNEL_RE);
});

test("marketing evidence only renders vendors that appear in evidence", () => {
  const summary = generateDay1SituationSummary({
    onboardingHypothesis: {
      productName: "mood.disk",
      targetUser: "출판을 원하는 기록 앱 사용자",
      problem: "기록을 책 형태로 만들 때 혼자서 판단하기 어렵다",
      purpose: "출판 요청부터 결제까지 앱 안에서 처리하려는 기록/출판 앱",
      goal: "첫 유료 출판 요청 1건을 만든다",
      stage: "first_users",
      confidence: "high",
      evidence: ["README.md", "marketing/roadmap.md"],
    },
    evidenceBuckets: {
      marketEvidence: {
        paths: ["marketing/roadmap.md"],
        snippets: ["channels: Instagram 릴스 / analytics: PostHog, UTM / conversion: 첫 유료 출판 요청 1건"],
      },
    },
    now: NOW,
  });

  assert.ok(summary.path.some((node) => node.label === "PostHog"));
  assert.ok(summary.path.some((node) => node.label === "UTM"));
  assert.ok(summary.path.some((node) => /릴스/.test(node.label)));
  assert.doesNotMatch(JSON.stringify(summary.path), /Search Console|App Store Ads/);
  assert.ok(summary.actions.some((action) => /PostHog|UTM|릴스|유료/.test(action.label) || /PostHog|UTM|릴스|유료/.test(action.rationale)));
});

test("analytics-only source evidence does not become customer path or primary action", () => {
  const summary = generateDay1SituationSummary({
    onboardingHypothesis: {
      productName: "agentic30 Mac",
      targetUser: "전업 1인 개발자",
      problem: "30일 동안 실제 사용자와 첫 매출까지 가는 루프가 약하다",
      purpose: "Agentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다",
      goal: "30일 안에 사용자 100명과 첫 매출 달성",
      stage: "prototype",
      confidence: "high",
      evidence: ["README.md"],
    },
    evidenceBuckets: {
      workspaceEvidence: {
        evidence: [
          {
            role: "source",
            path: "agentic30/PostHogTelemetry.swift",
            quote: "PostHogTelemetry captures app settings events.",
            score: 80,
          },
          {
            role: "goal",
            path: ".agentic30/docs/GOAL.md",
            quote: "목표는 30일 안에 사용자 100명과 첫 매출 가능성을 검증하는 것이다. 파일럿을 확인한다.",
            score: 90,
          },
          {
            role: "icp",
            path: ".agentic30/docs/ICP.md",
            quote: "Primary persona는 전업 1인 개발자이며 고객 인터뷰로 반복 pain point를 확인한다.",
            score: 90,
          },
        ],
        signals: {
          productName: "agentic30 Mac",
          targetUser: "전업 1인 개발자",
          problem: "고객 검증과 배포 루프가 약하다",
          goal: "30일 안에 사용자 100명과 첫 매출 달성",
          outcome: "첫 매출 가능성 확인",
        },
      },
      marketEvidence: {
        paths: ["posthog-setup-report.md"],
        snippets: ["PostHog post-wizard report for telemetry setup."],
      },
    },
    now: NOW,
  });

  assert.equal(summary.diagnosis.missingSignal, "고객에게 닿는 경로");
  assert.equal(summary.path.length, 0);
  assert.doesNotMatch(JSON.stringify(summary.actions), /PostHog/);
  assert.ok(summary.actions.some((action) => action.label === "전업 1인 개발자 접점"));
  assert.deepEqual(summary.baseline.metrics, ["사용자 100명", "첫 매출"]);
  assert.doesNotMatch(JSON.stringify({
    day30Question: summary.baseline.day30Question,
    metrics: summary.baseline.metrics,
  }), /목표는 30일|안에 사용자 100명|인 개발자를 위한 30일/);
});

test("README maintenance drift does not render customer-value reality gap", () => {
  const summary = generateDay1SituationSummary({
    onboardingHypothesis: baseHypothesis,
    driftFindings: {
      driftScore: 3,
      staleInReadme: [{ claim: "Runtime Requirements" }],
      missingFromReadme: [],
    },
    now: NOW,
  });

  assert.equal(summary.realityGap, null);
});

test("Day 1 situation summary value median stays above 9.5 across 10 fixtures", () => {
  const results = runDay1QualityFixturesOnce();
  const median = medianScore(results.map((result) => result.score.score));
  maybePrintDay1QualityReport({ type: "single-run", median, results: compactQualityResults(results) });
  assert.ok(
    median >= 9.5,
    JSON.stringify({
      median,
      results: compactQualityResults(results),
    }, null, 2),
  );
  assert.ok(results.filter((result) => result.summary.qualityGate.passed).every((result) => result.score.score >= 9), JSON.stringify(results, null, 2));

  const sourceOnly = results.find((result) => result.name === "source-only event");
  assert.doesNotMatch(JSON.stringify(sourceOnly.summary), /릴스|Meta Ads|Search Console|App Store Ads/);
  assert.ok(sourceOnly.summary.actions.some((action) => action.label === "quote followup 발송"));

  const empty = results.find((result) => result.name === "empty workspace");
  assert.equal(empty.summary.qualityGate.passed, false);
  assert.equal(empty.summary.path.length, 0);
  assert.equal(empty.summary.actions.length, 1);
  assert.match(empty.summary.project.oneLine, /고객·문제 근거/);

  const marketing = results.find((result) => result.name === "marketing explicit");
  assert.ok(marketing.summary.actions[0]?.label === "유료 신호 확인");
  assert.equal(new Set(marketing.summary.path.map((node) => node.label)).size, marketing.summary.path.length);
  assert.ok(
    results
      .filter((result) => result.summary.qualityGate.passed)
      .every((result) => Object.values(result.score.dimensions).every((score) => score >= 8.5)),
    JSON.stringify(results, null, 2),
  );
  assert.ok(empty.score.score <= 8.7, JSON.stringify(empty.score, null, 2));
  assert.ok(empty.score.dimensions.evidence < 8.5, JSON.stringify(empty.score, null, 2));
});

test("Day 1 sentence quality median stays above 9.5 across 10 repeated runs", () => {
  const runs = Array.from({ length: 10 }, (_, index) => {
    const results = runDay1QualityFixturesOnce();
    return {
      run: index + 1,
      median: medianScore(results.map((result) => result.score.score)),
      sentenceMedian: medianScore(results.map((result) => result.score.dimensions.sentence)),
      minSentence: Math.min(...results.map((result) => result.score.dimensions.sentence)),
      sentenceIssues: results.flatMap((result) =>
        result.score.reasons
          .filter((reason) => reason.startsWith("sentence:"))
          .map((reason) => ({ name: result.name, reason })),
      ),
    };
  });
  const medianOfRunMedians = medianScore(runs.map((run) => run.median));
  const medianOfSentenceMedians = medianScore(runs.map((run) => run.sentenceMedian));
  maybePrintDay1QualityReport({ type: "10-repeat", medianOfRunMedians, medianOfSentenceMedians, runs });
  assert.ok(medianOfRunMedians >= 9.5, JSON.stringify({ medianOfRunMedians, runs }, null, 2));
  assert.ok(medianOfSentenceMedians >= 9.5, JSON.stringify({ medianOfSentenceMedians, runs }, null, 2));
  assert.ok(runs.every((run) => run.sentenceMedian >= 9.5), JSON.stringify({ runs }, null, 2));
});

test("Day 1 value scorer penalizes raw and generic sentence quality issues", () => {
  const fixture = day1QualityFixtures().find((item) => item.name === "marketing explicit");
  const summary = generateDay1SituationSummary({ ...fixture.input, now: NOW });
  const poorCopy = JSON.parse(JSON.stringify(summary));
  poorCopy.actions[0].rationale = "channels: Instagram 릴스 / analytics: PostHog, UTM / conversion: 첫 유료 출판 요청 1건";
  poorCopy.path[0].label = "workout_checkin_created";
  poorCopy.diagnosis.whyNow = "고객과 문제 후보는 있지만 실제 행동으로 확인할 기준이 아직 약합니다.";

  const issues = sentenceQualityIssues(poorCopy).map((issue) => issue.reason);
  const evaluation = scoreDay1SummaryValue(poorCopy, fixture);
  assert.ok(issues.includes("raw metadata leaked"), JSON.stringify(issues));
  assert.ok(issues.includes("machine token visible"), JSON.stringify(issues));
  assert.ok(evaluation.dimensions.sentence < 9, JSON.stringify(evaluation, null, 2));
  assert.ok(evaluation.score < scoreDay1SummaryValue(summary, fixture).score);
});

test("Day 1 value scorer rejects schema-valid but strategically weak summaries", () => {
  const fixture = day1QualityFixtures().find((item) => item.name === "CS SaaS rich");
  const summary = generateDay1SituationSummary({ ...fixture.input, now: NOW });
  const weak = JSON.parse(JSON.stringify(summary));
  weak.project.customer = "사용자";
  weak.project.problem = "문제";
  weak.diagnosis.bottleneck = "오늘 실행 행동을 하나로 압축할 차례";
  weak.diagnosis.whyNow = "고객, 문제, 행동 근거가 있으니 한 가지 검증 행동으로 줄일 수 있습니다.";
  weak.path = [{ label: "PostHog", kind: "analytics", status: "found", why: "PostHog에서 봅니다.", evidenceRefs: ["research/cs.md"] }];
  weak.actions = [{ ...weak.actions[0], label: "고객 행동 확인", kind: "workflow", rationale: "확인합니다." }];
  weak.baseline.metrics = ["개선"];
  weak.baseline.day30Question = "30일 뒤 근거가 실제로 남았나요?";

  const evaluation = scoreDay1SummaryValue(weak, fixture);
  assert.ok(evaluation.score < 7, JSON.stringify(evaluation, null, 2));
  assert.ok(evaluation.dimensions.demand < 9, JSON.stringify(evaluation, null, 2));
  assert.ok(evaluation.dimensions.path < 9, JSON.stringify(evaluation, null, 2));
  assert.ok(evaluation.dimensions.actionability < 9, JSON.stringify(evaluation, null, 2));
});

test("Day 1 path puts customer touchpoints before measurement support", () => {
  const fixture = day1QualityFixtures().find((item) => item.name === "consumer event");
  const summary = generateDay1SituationSummary({ ...fixture.input, now: NOW });
  assert.ok(["channel", "workflow"].includes(summary.path[0]?.kind), JSON.stringify(summary.path, null, 2));
  assert.equal(scoreDay1SummaryValue(summary, fixture).dimensions.path, 10);
});

test("buildDay1SituationSummary merges verified agent situation signals", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-summary-"));
  try {
    await fs.writeFile(path.join(root, "README.md"), "# EscalationLens\nCS 리드가 위험 티켓을 먼저 보게 한다.\n");
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "Target user: B2B CS 리드\nProblem: Slack 에스컬레이션이 SLA 전에 누락된다.\n");
    await fs.writeFile(path.join(root, "marketing.md"), "Channel: partner webinar\nMetric: 파일럿 3팀\n");
    const summary = await buildDay1SituationSummary({
      workspaceRoot: root,
      scanResult: { docs: "README.md", icp: ".agentic30/docs/ICP.md" },
      onboardingHypothesis: baseHypothesis,
      agentSituationSignals: [{
        channels: [{ label: "partner webinar", evidencePath: "marketing.md", shortQuote: "Channel: partner webinar" }],
        analyticsTools: [],
        events: [{ label: "파일럿 3팀", evidencePath: "marketing.md", shortQuote: "Metric: 파일럿 3팀" }],
        customerActions: [],
        currentAlternatives: [],
        conversionSignals: [],
        missingAssumptions: [],
      }],
      now: NOW,
      gitSubjectsImpl: async () => [],
    });

    assert.equal(summary.source, "agent_refined");
    assert.ok(summary.path.some((node) => node.label === "partner webinar"));
    assert.ok(summary.baseline.metrics.some((metric) => /파일럿 3팀/.test(metric)));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("composeDay1SituationSummary falls back to local evidence without queryImpl", async () => {
  const deterministic = generateDay1SituationSummary({
    onboardingHypothesis: baseHypothesis,
    now: NOW,
  });
  const composed = await composeDay1SituationSummary({ deterministic });
  assert.equal(composed.source, "local_evidence");
  assert.deepEqual(composed.project, deterministic.project);
  assert.deepEqual(composed.actions, deterministic.actions);
});

function runDay1QualityFixturesOnce() {
  return day1QualityFixtures().map((fixture) => {
    const summary = generateDay1SituationSummary({ ...fixture.input, now: NOW });
    return { name: fixture.name, score: scoreDay1SummaryValue(summary, fixture), summary };
  });
}

function compactQualityResults(results) {
  return results.map((result) => ({
    name: result.name,
    score: result.score.score,
    dimensions: result.score.dimensions,
    reasons: result.score.reasons,
    actions: result.summary.actions.map((action) => action.label),
    path: result.summary.path.map((node) => node.label),
  }));
}

function maybePrintDay1QualityReport(report) {
  if (process.env.AGENTIC30_PRINT_DAY1_QUALITY !== "1") return;
  console.log(JSON.stringify(report, null, 2));
}

function day1QualityFixtures() {
  return [
    {
      name: "agentic30 missing path",
      input: {
        onboardingHypothesis: {
          productName: "agentic30 Mac",
          targetUser: "전업 1인 개발자",
          problem: "30일 동안 실제 사용자와 첫 매출까지 가는 루프가 약하다",
          purpose: "전업 1인 개발자를 위한 30일 부트캠프. 사용자 100명과 첫 매출 달성을 목표로 한다",
          goal: "30일 안에 사용자 100명과 첫 매출 달성",
          stage: "prototype",
          confidence: "high",
          evidence: ["README.md"],
        },
        evidenceBuckets: {
          workspaceEvidence: {
            evidence: [
              { role: "goal", path: ".agentic30/docs/GOAL.md", quote: "목표는 30일 안에 사용자 100명과 첫 매출 가능성을 검증하는 것이다. 파일럿을 확인한다.", score: 90 },
              { role: "icp", path: ".agentic30/docs/ICP.md", quote: "Primary persona는 전업 1인 개발자이며 고객 인터뷰로 반복 pain point를 확인한다.", score: 90 },
            ],
            signals: {
              productName: "agentic30 Mac",
              targetUser: "전업 1인 개발자",
              problem: "고객 검증과 배포 루프가 약하다",
              goal: "30일 안에 사용자 100명과 첫 매출 달성",
              outcome: "첫 매출 가능성 확인",
            },
          },
        },
      },
    },
    {
      name: "CS SaaS rich",
      input: {
        onboardingHypothesis: baseHypothesis,
        evidenceBuckets: {
          customerEvidence: {
            paths: ["research/cs.md"],
            snippets: ["CS 리드는 현재 Slack thread와 Zendesk dashboard를 매일 직접 확인한다. 파일럿 미팅 2건 예정. Metric: SLA 누락 1건 감소"],
          },
        },
      },
    },
    {
      name: "developer tool event",
      input: {
        onboardingHypothesis: {
          productName: "TraceKit",
          projectKind: "developer_tool",
          targetUser: "OpenTelemetry를 쓰는 플랫폼 엔지니어",
          problem: "분산 trace 비용과 노이즈가 크다",
          purpose: "trace sampling rule을 안전하게 조정한다",
          goal: "팀 2곳에서 noisy endpoint 비용을 20% 줄인다",
          stage: "first_users",
          confidence: "high",
          evidence: ["README.md"],
        },
        evidenceBuckets: {
          workspaceEvidence: {
            evidence: [
              { role: "source", path: "src/sampler.ts", quote: "customer: platform engineer / goal: reduce trace volume by 20% / event: sampling_rule_applied", score: 80 },
            ],
            signals: {
              productName: "TraceKit",
              targetUser: "OpenTelemetry를 쓰는 플랫폼 엔지니어",
              problem: "분산 trace 비용과 노이즈가 크다",
              goal: "팀 2곳에서 noisy endpoint 비용을 20% 줄인다",
              outcome: "sampling_rule_applied 이벤트를 확인한다",
            },
          },
        },
      },
    },
    {
      name: "empty workspace",
      input: { onboardingHypothesis: {} },
    },
    {
      name: "marketing explicit",
      input: {
        onboardingHypothesis: {
          productName: "mood.disk",
          targetUser: "출판을 원하는 기록 앱 사용자",
          problem: "기록을 책 형태로 만들 때 혼자서 판단하기 어렵다",
          purpose: "출판 요청부터 결제까지 앱 안에서 처리하려는 기록/출판 앱",
          goal: "첫 유료 출판 요청 1건을 만든다",
          stage: "first_users",
          confidence: "high",
          evidence: ["README.md", "marketing/roadmap.md"],
        },
        evidenceBuckets: {
          marketEvidence: {
            paths: ["marketing/roadmap.md"],
            snippets: ["channels: Instagram 릴스 / analytics: PostHog, UTM / conversion: 첫 유료 출판 요청 1건"],
          },
        },
      },
    },
    {
      name: "B2B sales no metric",
      input: {
        onboardingHypothesis: {
          productName: "DealReview",
          targetUser: "초기 B2B SaaS 창업자",
          problem: "세일즈 콜 뒤 다음 액션이 흩어진다",
          purpose: "콜 녹취에서 다음 액션을 정리한다",
          goal: "파일럿 창업자 5명과 재사용 의향 확인",
          stage: "first_users",
          confidence: "high",
          evidence: ["README.md"],
        },
        evidenceBuckets: {
          customerEvidence: {
            paths: ["interviews/founder.md"],
            snippets: ["고객 인터뷰: 초기 B2B SaaS 창업자는 Gong 대신 Notion과 이메일로 콜 후속조치를 정리한다. 파일럿 후보 5명"],
          },
        },
      },
    },
    {
      name: "consumer event",
      input: {
        onboardingHypothesis: {
          productName: "FitLoop",
          targetUser: "퇴근 후 운동을 미루는 직장인",
          problem: "혼자 운동 계획을 반복하지 못한다",
          purpose: "친구와 짧은 운동 약속을 만든다",
          goal: "7일 안에 20명이 운동 인증 3회를 남긴다",
          stage: "prototype",
          confidence: "high",
          evidence: ["README.md"],
        },
        evidenceBuckets: {
          marketEvidence: {
            paths: ["landing.md"],
            snippets: ["채널: 회사 Slack 커뮤니티, 친구 초대 / 이벤트: workout_checkin_created / Metric: 운동 인증 3회"],
          },
        },
      },
    },
    {
      name: "paid community",
      input: {
        onboardingHypothesis: {
          productName: "LegalSprint",
          targetUser: "1인 로펌 변호사",
          problem: "상담 내용을 상품화하지 못한다",
          purpose: "상담 템플릿을 유료 패키지로 만든다",
          goal: "첫 결제 1건 또는 구매 의향 3건",
          stage: "pre_revenue",
          confidence: "high",
          evidence: [".agentic30/docs/GOAL.md"],
        },
        evidenceBuckets: {
          customerEvidence: {
            paths: ["research/lawyer.md"],
            snippets: ["1인 로펌 변호사는 현재 이메일과 워드 문서로 상담지를 만든다. 결제 의사: 템플릿 패키지 9만원이면 구매 가능"],
          },
        },
      },
    },
    {
      name: "meaningful drift",
      input: {
        onboardingHypothesis: {
          productName: "ShopPulse",
          targetUser: "소상공인 쇼핑몰 운영자",
          problem: "광고비 대비 재구매를 모른다",
          purpose: "광고별 재구매 대시보드",
          goal: "소상공인 3명에게 재구매 리포트 확인",
          stage: "prototype",
          confidence: "high",
          evidence: ["README.md"],
        },
        driftFindings: {
          driftScore: 4,
          staleInReadme: [{ claim: "소상공인 쇼핑몰 운영자를 위한 광고별 재구매 대시보드" }],
          missingFromReadme: [{ term: "결제 의사" }, { term: "고객 인터뷰" }],
        },
      },
    },
    {
      name: "source-only event",
      input: {
        onboardingHypothesis: {
          productName: "TinyCRM",
          targetUser: "프리랜서 디자이너",
          problem: "견적 후 follow-up을 놓친다",
          purpose: "견적 후속 연락을 자동 알림한다",
          goal: "견적 후속 응답 10건 확인",
          stage: "building",
          confidence: "medium",
          evidence: ["README.md"],
        },
        evidenceBuckets: {
          workspaceEvidence: {
            evidence: [
              { role: "source", path: "src/events.ts", quote: "event: quote_followup_sent metric: reply_count customer: freelance designer", score: 75 },
            ],
            signals: {
              productName: "TinyCRM",
              targetUser: "프리랜서 디자이너",
              problem: "견적 후 follow-up을 놓친다",
              goal: "견적 후속 응답 10건 확인",
              outcome: "reply_count 이벤트를 확인한다",
            },
          },
        },
      },
    },
  ];
}

function scoreDay1SummaryValue(summary, fixture) {
  const evaluation = evaluateDay1SummaryValue(summary, fixture);
  return {
    score: evaluation.score,
    reasons: evaluation.issues.map((issue) => `${issue.dimension}: ${issue.reason}`),
    dimensions: evaluation.dimensions,
  };
}

function evaluateDay1SummaryValue(summary, fixture) {
  let score = 10;
  const issues = [];
  const dimensions = {
    evidence: 10,
    demand: 10,
    diagnosis: 10,
    path: 10,
    actionability: 10,
    measurement: 10,
    sentence: 10,
    copy: 10,
  };
  const parsed = Day1SituationSummarySchema.safeParse(summary);
  if (!parsed.success) lose(2, "schema invalid", "evidence");
  const serialized = JSON.stringify(summary);
  if (/최근\s*\d+개\s*커밋|핫스팟|Runtime Requirements|이 프로젝트: 프로젝트/.test(serialized)) lose(1.5, "noisy internal value", "copy");
  if (ungroundedForbiddenSignals(summary, fixture).length) lose(2, "ungrounded vendor/channel", "evidence");
  if (!summary.qualityGate.passed) lose(1.3, "evidence-limited summary has limited decision value", "evidence");

  if (!summary.project.oneLine || summary.project.oneLine.length > 160) lose(0.8, "weak project oneLine", "copy");
  if (summary.qualityGate.passed && /확인 필요|근거 부족/.test(`${summary.project.customer} ${summary.project.problem}`)) lose(1, "passed with weak customer/problem", "demand");

  if (!summary.diagnosis.bottleneck || summary.diagnosis.bottleneck.length > 35) lose(0.7, "diagnosis not crisp", "diagnosis");
  if (!summary.diagnosis.whyNow || summary.diagnosis.whyNow.length > 85) lose(0.5, "whyNow not concise", "diagnosis");
  if (summary.path.length && summary.diagnosis.missingSignal === "고객에게 닿는 경로") lose(1.2, "path conflicts with missing path diagnosis", "path");

  if (summary.qualityGate.passed && summary.baseline.metrics.length === 0) lose(1, "missing baseline metric", "measurement");
  if (summary.baseline.metrics.some((metric) => /^(에게|에서|으로|이|가|은|는|을|를|또는|및)\s/.test(metric))) lose(0.5, "unpolished metric", "measurement");

  if (!summary.qualityGate.passed && (summary.path.length > 0 || summary.actions.length > 1 || summary.actions.some((action) => !action.evidenceLimited))) {
    lose(1.5, "overclaims weak evidence", "evidence");
  }
  if (summary.qualityGate.passed && summary.actions.length === 0) lose(1.5, "missing actions", "actionability");
  if (summary.actions.length > 3) lose(1, "too many actions", "actionability");
  if (summary.actions.some((action) => action.label.length > 22 || /…|^(Metric|Event|이벤트|지표)\s*[:：=-]/.test(action.label))) lose(0.8, "unpolished action label", "copy");
  if (summary.actions.some((action) => action.evidenceRefs.length === 0 && !action.evidenceLimited)) lose(1, "action without evidence", "evidence");
  if (summary.actions.some((action) => /근거를 오늘 실제 행동으로 확인합니다/.test(action.rationale))) lose(0.8, "generic action rationale", "actionability");
  if (hasDuplicateOrContainedLabels(summary.path.map((node) => node.label))) lose(0.6, "duplicate path labels", "path");
  if (hasDuplicateOrContainedLabels(summary.actions.map((action) => action.label))) lose(0.6, "duplicate action labels", "actionability");
  for (const issue of sentenceQualityIssues(summary)) lose(issue.points, `${issue.field} ${issue.reason}`, "sentence");
  for (const issue of strategicQualityIssues(summary)) lose(issue.points, issue.reason, issue.dimension);

  return {
    score: Number(Math.max(0, score).toFixed(1)),
    dimensions: Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, Number(Math.max(0, value).toFixed(1))])),
    issues,
  };

  function lose(points, reason, dimension = "copy") {
    score -= points;
    dimensions[dimension] = Math.max(0, (dimensions[dimension] ?? 10) - points * 1.8);
    issues.push({ dimension, reason, points });
  }
}

function strategicQualityIssues(summary) {
  return [
    ...demandSpecificityIssues(summary),
    ...diagnosisValueIssues(summary),
    ...pathValueIssues(summary),
    ...actionabilityIssues(summary),
    ...measurementValueIssues(summary),
    ...visibleEconomyIssues(summary),
  ];
}

function demandSpecificityIssues(summary) {
  const issues = [];
  const customer = cleanVisible(summary.project?.customer);
  const problem = cleanVisible(summary.project?.problem);
  if (summary.qualityGate?.passed && vagueCustomer(customer)) {
    issues.push({ dimension: "demand", reason: "customer segment is too vague", points: 0.9 });
  }
  if (summary.qualityGate?.passed && weakProblem(problem)) {
    issues.push({ dimension: "demand", reason: "problem is not a concrete pain", points: 0.9 });
  }
  if (summary.qualityGate?.passed && !/(고객|사용자|팀|창업자|개발자|리드|엔지니어|직장인|변호사|디자이너|운영자|founder|engineer|user|customer|team)/i.test(customer)) {
    issues.push({ dimension: "demand", reason: "customer field lacks a human segment", points: 0.5 });
  }
  return issues;
}

function diagnosisValueIssues(summary) {
  const issues = [];
  const bottleneck = cleanVisible(summary.diagnosis?.bottleneck);
  const whyNow = cleanVisible(summary.diagnosis?.whyNow);
  if (/오늘 실행 행동을 하나로 압축할 차례/.test(bottleneck)) {
    issues.push({ dimension: "diagnosis", reason: "bottleneck is generic instead of project-specific", points: 0.7 });
  }
  if (/고객,\s*문제,\s*행동 근거가 있으니/.test(whyNow)) {
    issues.push({ dimension: "diagnosis", reason: "whyNow repeats framework instead of evidence", points: 0.6 });
  }
  if (summary.diagnosis?.missingSignal === "고객에게 닿는 경로" && summary.path?.length) {
    issues.push({ dimension: "diagnosis", reason: "missing signal contradicts visible path", points: 0.7 });
  }
  return issues;
}

function pathValueIssues(summary) {
  const issues = [];
  const path = summary.path || [];
  if (!path.length) return issues;
  const firstTouchpointIndex = path.findIndex((node) => ["channel", "workflow"].includes(node.kind));
  const firstSupportIndex = path.findIndex((node) => ["analytics", "event", "metric"].includes(node.kind));
  if (firstTouchpointIndex === -1) {
    issues.push({ dimension: "path", reason: "path has no customer touchpoint", points: 1.2 });
  } else if (firstSupportIndex !== -1 && firstSupportIndex < firstTouchpointIndex) {
    issues.push({ dimension: "path", reason: "measurement appears before customer touchpoint", points: 0.8 });
  }
  if (path.some((node) => node.kind === "analytics") && !path.some((node) => ["channel", "workflow"].includes(node.kind))) {
    issues.push({ dimension: "path", reason: "analytics shown as path without customer route", points: 0.9 });
  }
  return issues;
}

function actionabilityIssues(summary) {
  const issues = [];
  const actions = summary.actions || [];
  const primary = actions[0];
  if (summary.qualityGate?.passed && primary && ["analytics", "workflow"].includes(primary.kind)) {
    issues.push({ dimension: "actionability", reason: "primary action is a tool check, not customer outcome", points: 0.9 });
  }
  if (summary.qualityGate?.passed && primary && /^(근거 채우기|고객 행동 확인|현재 대안 확인)$/.test(primary.label)) {
    issues.push({ dimension: "actionability", reason: "primary action label is generic", points: 0.8 });
  }
  if (summary.qualityGate?.passed && actions.filter((action) => /확인$/.test(action.label)).length > 1) {
    issues.push({ dimension: "actionability", reason: "too many action labels collapse to 확인", points: 0.4 });
  }
  for (const [index, action] of actions.entries()) {
    if (summary.qualityGate?.passed && !actionableRationale(action.rationale)) {
      issues.push({ dimension: "actionability", reason: `action[${index}] lacks an observable completion verb`, points: 0.5 });
    }
  }
  return issues;
}

function measurementValueIssues(summary) {
  const issues = [];
  const metrics = summary.baseline?.metrics || [];
  const question = cleanVisible(summary.baseline?.day30Question);
  if (summary.qualityGate?.passed && metrics.length && !metrics.some((metric) => question.includes(metric))) {
    issues.push({ dimension: "measurement", reason: "day30 question does not reuse chosen metric", points: 0.7 });
  }
  if (summary.qualityGate?.passed && metrics.length && !metrics.some((metric) => measurableMetric(metric))) {
    issues.push({ dimension: "measurement", reason: "baseline lacks count, money, event, or conversion signal", points: 0.8 });
  }
  if (/근거가 실제로 남았나요/.test(question)) {
    issues.push({ dimension: "measurement", reason: "day30 question asks for evidence residue, not outcome", points: 0.5 });
  }
  return issues;
}

function visibleEconomyIssues(summary) {
  const issues = [];
  const text = visibleCopyFields(summary).map((field) => cleanVisible(field.value)).filter(Boolean).join(" ");
  if (termCount(text, "근거") > 7) {
    issues.push({ dimension: "copy", reason: "visible copy overuses 근거", points: 0.5 });
  }
  if (termCount(text, "확인") > 9) {
    issues.push({ dimension: "copy", reason: "visible copy overuses 확인", points: 0.4 });
  }
  if ((summary.actions || []).length === 3 && hasSameVerbSuffix(summary.actions.map((action) => action.label))) {
    issues.push({ dimension: "copy", reason: "action labels all share the same verb", points: 0.4 });
  }
  return issues;
}

function cleanVisible(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function vagueCustomer(value) {
  return /^(고객|사용자|유저|팀|사람|everyone|users?|customers?|people)$/i.test(cleanVisible(value));
}

function weakProblem(value) {
  const text = cleanVisible(value);
  if (!text || /확인 필요|근거 부족/.test(text)) return true;
  return /^(문제|pain|불편|개선|관리|도움|성장|효율|생산성)(?:\s|$)/i.test(text) && text.length < 18;
}

function actionableRationale(value) {
  return /(정합니다|특정합니다|기록합니다|남깁니다|비교|대화|묻고|측정|찍히는지|위치|시작값|조건|장소|후보)/.test(cleanVisible(value));
}

function measurableMetric(value) {
  return /\d|%|명|건|팀|원|만원|매출|유료|결제|구매|파일럿|가입|전환|응답|이벤트|event|revenue|paid|payment|signup|conversion/i.test(cleanVisible(value));
}

function hasSameVerbSuffix(labels) {
  const suffixes = labels
    .map((label) => cleanVisible(label).split(/\s+/).pop())
    .filter(Boolean);
  return suffixes.length >= 3 && new Set(suffixes).size === 1;
}

function sentenceQualityIssues(summary) {
  const issues = [];
  for (const field of visibleCopyFields(summary)) {
    const text = String(field.value || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const length = Array.from(text).length;
    if (field.max && length > field.max) {
      issues.push({ field: field.name, reason: `too long (${length}/${field.max})`, points: 0.4 });
    }
    if (rawMetadataFragment(text)) {
      issues.push({ field: field.name, reason: "raw metadata leaked", points: 0.9 });
    }
    if (rawInternalArtifact(text)) {
      issues.push({ field: field.name, reason: "internal artifact leaked", points: 0.8 });
    }
    if (machineToken(text)) {
      issues.push({ field: field.name, reason: "machine token visible", points: 0.6 });
    }
    if (awkwardKoreanParticle(text)) {
      issues.push({ field: field.name, reason: "awkward particle", points: 0.5 });
    }
    if (field.kind === "sentence" && !sentenceLikeEnding(text)) {
      issues.push({ field: field.name, reason: "not sentence-like", points: 0.3 });
    }
    if (genericVisibleCopy(text)) {
      issues.push({ field: field.name, reason: "generic copy", points: 0.5 });
    }
    if (termCount(text, "근거") > 2 || termCount(text, "확인") > 2) {
      issues.push({ field: field.name, reason: "repetitive wording", points: 0.3 });
    }
  }
  return issues;
}

function visibleCopyFields(summary) {
  const fields = [
    { name: "project.oneLine", value: summary.project?.oneLine, kind: "sentence", max: 125 },
    { name: "diagnosis.bottleneck", value: summary.diagnosis?.bottleneck, kind: "label", max: 26 },
    { name: "diagnosis.whyNow", value: summary.diagnosis?.whyNow, kind: "sentence", max: 78 },
    { name: "baseline.day30Question", value: summary.baseline?.day30Question, kind: "sentence", max: 82 },
  ];
  if (summary.realityGap) {
    fields.push(
      { name: "realityGap.docClaim", value: summary.realityGap.docClaim, kind: "label", max: 90 },
      { name: "realityGap.observedReality", value: summary.realityGap.observedReality, kind: "sentence", max: 92 },
      { name: "realityGap.recommendation", value: summary.realityGap.recommendation, kind: "sentence", max: 82 },
    );
  }
  for (const [index, node] of (summary.path || []).entries()) {
    fields.push({ name: `path[${index}].label`, value: node.label, kind: "label", max: 26 });
  }
  for (const [index, action] of (summary.actions || []).entries()) {
    fields.push(
      { name: `actions[${index}].label`, value: action.label, kind: "label", max: 18 },
      { name: `actions[${index}].rationale`, value: action.rationale, kind: "sentence", max: 82 },
    );
  }
  return fields;
}

function rawMetadataFragment(text) {
  return /\b(?:channels?|analytics|events?|metrics?|customer|goal|problem|conversion|target\s+user)\s*[:=]/i.test(text)
    || /(?:채널|이벤트|지표|고객|목표|문제|전환)\s*[:：=]/.test(text)
    || /\s\/\s.*(?:[:：=]|,)\s*/.test(text);
}

function rawInternalArtifact(text) {
  return /(?:Runtime Requirements|docs\/|src\/|workspace|source|agent signal|onboarding hypothesis|wizard-report|\.(?:md|ts|tsx|js|mjs|swift)\b)/i.test(text)
    || /[`{}<>]/.test(text);
}

function machineToken(text) {
  return /\b[a-z][a-z0-9]+(?:_[a-z0-9]+)+\b/i.test(text);
}

function awkwardKoreanParticle(text) {
  return /(경로을|접점를|신호을|의사을|행동을이|이 실제 고객 행동인지|을 실제 고객 행동인지|를 실제 고객 행동인지)/.test(text);
}

function sentenceLikeEnding(text) {
  return /[.?!。]$/.test(text) || /(다|니다|세요|나요|까요|됩니다|습니다)$/.test(text);
}

function genericVisibleCopy(text) {
  return /근거를 오늘 실제 행동으로 확인합니다|완료 근거를 오늘 한 줄로 남깁니다|근거가 workspace에 있습니다/.test(text);
}

function termCount(text, term) {
  return (text.match(new RegExp(term, "g")) || []).length;
}

function ungroundedForbiddenSignals(summary, fixture) {
  const source = JSON.stringify(fixture.input || "");
  const visible = JSON.stringify({
    path: summary.path.map((node) => node.label),
    actions: summary.actions.map((action) => action.label),
  });
  return ["PostHog", "UTM", "릴스", "Meta Ads", "Search Console", "App Store Ads"]
    .filter((signal) => new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(visible))
    .filter((signal) => !new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(source));
}

function hasDuplicateOrContainedLabels(labels) {
  const normalized = labels.map((label) => String(label || "").trim().toLowerCase()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) return true;
  return normalized.some((label, index) =>
    normalized.some((other, otherIndex) => index !== otherIndex && label.length >= 4 && other.length > label.length && other.includes(label))
  );
}

function medianScore(scores) {
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

import test from "node:test";
import assert from "node:assert/strict";

import {
  MorningBriefingVerdictError,
  buildMorningBriefingVerdictEvidenceBundle,
  buildMorningBriefingVerdictContext,
  buildMorningBriefingVerdictPrompt,
  isMorningBriefingLlmVerdict,
  normalizeMorningBriefingLlmVerdict,
} from "../sidecar/morning-briefing-verdict.mjs";

function onboardingFixture() {
  return {
    answers: {
      timeBudget: {
        question: "하루에 얼마나 시간을 쓸 수 있나요?",
        answer: "퇴근 후 2시간",
      },
      primaryFocus: {
        question: "요즘 어디에 시간을 쓰나요?",
        answer: "macOS 메뉴바 제품의 첫 고객 검증",
      },
      primaryBottleneck: {
        question: "가장 큰 병목은?",
        answer: "빌드는 되지만 실제 사용 증거가 부족함",
      },
    },
    onboardingContext: {
      business_description: "1인 개발자를 위한 macOS 작업 코치",
      current_stage: "첫 유료 사용자 전 검증",
      goal: "30일 안에 반복 사용 증거 확보",
    },
  };
}

function day1GoalFixture() {
  return {
    goalType: "get_users",
    goalText: "1인 개발자 3명이 실제 프로젝트에서 Agentic30을 써 보게 한다",
    customer: "퇴근 후 제품을 만드는 1인 개발자",
    problem: "고객 검증보다 기능 빌드로 도망간다",
    validationAction: "Office Hours 질문에 답하고 첫 핵심 행동을 완료한다",
    proofSink: "local",
    evidenceRefs: ["PostHog first_core_action", "Cloudflare landing visit"],
  };
}

function officeHoursHistoryFixture() {
  return {
    day: 3,
    officeHoursTurns: [
      "Day 2 Q: 누구에게 보여줄 수 있나? A: 독립 개발자 지인 2명에게 설치 링크를 보낸다.",
      "Day 3 Q: 확인할 행동은? A: workspace scan 완료와 Office Hours 답변을 본다.",
    ],
    openCommitments: ["Day 3: 설치 링크를 보낸 뒤 scan 완료 증거를 확인한다."],
    metCommitments: ["Day 2: 랜딩 방문 20명 이상 확인."],
    sourceReads: ["PostHog aggregate dashboard read", "Cloudflare aggregate traffic read"],
    dayRollup: [{ day: 2, summary: "링크 공유는 했지만 scan 완료 증거는 부족함" }],
    currentDayMemory: { summary: { text: "오늘은 첫 핵심 행동 증거를 닫는 날" } },
  };
}

function officeHoursSummaryFixture() {
  return {
    compiledTruth: "빌드 속도는 충분하지만 고객 행동 증거가 약하다.",
    openThreads: ["설치 이후 workspace scan을 완료하는지 확인"],
    abandonedThreads: [],
    calibrationLine: "예측 적중 1/2",
    pendingPrediction: "Cloudflare 방문이 늘어도 PostHog 핵심 행동은 낮을 수 있다.",
    consecutiveDeferrals: 1,
  };
}

function digestFixture({ conversions = 0, cloudflareVisits = 223, gitCommits = 7 } = {}) {
  return {
    sources: [
      {
        id: "git",
        label: "git",
        state: "ready",
        selected: true,
        counts: { commits: gitCommits, additions: 144 },
        summary: `git 커밋 ${gitCommits}건`,
        highlights: [`git 커밋 ${gitCommits}건`, "feat: verdict prompt"],
      },
      {
        id: "gh_cli",
        label: "gh CLI",
        state: "ready",
        selected: true,
        counts: { prs: 2, mergedPrs: 1, releases: 1 },
        summary: "PR 업데이트 2건",
        highlights: ["PR 업데이트 2건 · merged 1건"],
      },
      {
        id: "cloudflare",
        label: "Cloudflare",
        state: "ready",
        selected: true,
        counts: { visits: cloudflareVisits, uniqueVisitors: cloudflareVisits, pageviews: 501, requests: 1204 },
        summary: `Cloudflare 순 방문 ${cloudflareVisits}명`,
        highlights: [
          `Cloudflare 순 방문 ${cloudflareVisits}명 · 요청 1204건`,
          "raw visitor founder@example.com from 203.0.113.4",
        ],
      },
      {
        id: "posthog",
        label: "PostHog",
        state: "ready",
        selected: true,
        counts: { activeUsers: 1, events: 26, conversions, signups: 0, installs: 9, payments: 0 },
        summary: "PostHog 활성 사용자 1명",
        highlights: ["PostHog 활성 사용자 1명 · 전환 0건", "token phx_abcdefghijklmnopqrstuvwxyz"],
        evidenceGaps: ["workspace scan 완료 증거 부족"],
      },
    ],
    briefing: {
      biggestEvidenceGap: ["PostHog: workspace scan 완료 증거 부족"],
    },
  };
}

function briefingFixture() {
  return {
    actions: [
      { id: "message" },
      { id: "experiment" },
      { id: "task" },
    ],
    cards: [
      { id: "cloudflare", label: "Cloudflare", state: "ready", rows: [{ k: "요청", v: "1204" }] },
      { id: "github", label: "GitHub", state: "ready", rows: [{ k: "PR 머지", v: "1" }] },
      { id: "posthog", label: "PostHog", state: "ready", rows: [{ k: "전환", v: "0" }] },
    ],
    evidenceFunnel: {
      steps: [
        { id: "traffic", label: "방문", source: "Cloudflare", value: 223, valueLabel: "223 명", status: "observed" },
        { id: "download_install", label: "다운로드/설치", source: "PostHog", value: 9, valueLabel: "9 명", status: "observed" },
        { id: "validation_action", label: "검증 행동", source: "PostHog", value: 0, valueLabel: "0 명", status: "missing" },
      ],
    },
    drilldowns: {
      cloudflare: { kpis: [{ label: "순 방문", valueLabel: "223" }, { label: "요청", valueLabel: "1204" }] },
      posthog: { kpis: [{ label: "활성 사용자", valueLabel: "1" }, { label: "이벤트", valueLabel: "26" }] },
    },
  };
}

function emptyProofLedgerFixture() {
  return {
    schemaVersion: 2,
    updatedAt: "2026-06-16T00:00:00.000Z",
    events: [],
  };
}

function customerProofLedgerFixture() {
  return {
    schemaVersion: 2,
    updatedAt: "2026-06-16T00:00:00.000Z",
    events: [
      {
        type: "interview",
        status: "accepted",
        strength: "medium",
        day: 3,
        customer: "founder@example.com",
        sourceUrl: "https://example.com/private/customer",
        summary: "실제 설치 의향 확인",
      },
    ],
  };
}

function activeUsersFixture({ rowCount = 1, checkedAt = "2026-06-16T00:00:00.000Z", status = "ok" } = {}) {
  return {
    signal: {
      observed: rowCount >= 1,
      rowCount,
      checkedAt,
      firstValueEventName: "first_value",
    },
    collectionStatus: { status },
  };
}

function evidenceOsFixture({ overdueDebts = 0, provenEvidence = 1 } = {}) {
  return {
    currentDay: 3,
    openDebts: [],
    overdueDebts: Array.from({ length: overdueDebts }, (_, index) => ({ id: `debt-${index + 1}` })),
    provenEvidence: Array.from({ length: provenEvidence }, (_, index) => ({ id: `proof-${index + 1}` })),
    dayStates: {
      "3": {
        state: overdueDebts > 0 ? "commitment_unproven" : "evidence_confirmed",
        carryForwardAction: overdueDebts > 0 ? "증거 부채 1개 닫기" : "",
      },
    },
  };
}

function blockedGateEvaluationFixture() {
  return {
    evaluatedAt: "2026-06-16T00:00:00.000Z",
    blockingGate: {
      gateId: "G4",
      title: "유료 ask + 계측",
      state: "blocked",
      blockedReason: "first_value_observed",
      requiredEvidence: [{ id: "first_value_observed", label: "first_value 이벤트 ≥1행" }],
      conditions: [{ id: "first_value_observed", label: "first_value 이벤트 ≥1행", sourceUnavailable: false }],
    },
    gates: {},
  };
}

function workHistoryFixture() {
  return {
    generatedAt: "2026-06-16T00:00:00.000Z",
    totals: {
      sessionCount: 5,
      myCommitCount: 7,
      aiMinutes: 180,
    },
    unclassified: [{ id: "session-1" }],
  };
}

function adaptiveRuleSignalsFixture() {
  return {
    signals: {
      buildWithoutCustomerEvidenceDays: 2,
      weakOnlyEvidenceDays: 1,
      abandonedThreadCount: 1,
      paymentIntentCount: 0,
      paymentRecordCount: 0,
    },
  };
}

function buildContext(overrides = {}) {
  return buildMorningBriefingVerdictContext({
    onboardingMemory: onboardingFixture(),
    day1GoalSelection: day1GoalFixture(),
    officeHoursHistory: officeHoursHistoryFixture(),
    officeHoursMemorySummary: officeHoursSummaryFixture(),
    officeHoursHistoryPrompt: "Office Hours 질문/답변: workspace scan 완료 여부를 확인한다.",
    digest: digestFixture(),
    briefing: briefingFixture(),
    proofLedger: emptyProofLedgerFixture(),
    evidenceOS: evidenceOsFixture({ provenEvidence: 0 }),
    currentDay: 3,
    ...overrides,
  });
}

test("buildMorningBriefingVerdictContext fails without required context or source evidence", () => {
  assert.throws(
    () => buildContext({ onboardingMemory: null }),
    (error) => error instanceof MorningBriefingVerdictError && error.code === "missing_onboarding",
  );
  assert.throws(
    () => buildContext({ day1GoalSelection: null }),
    (error) => error instanceof MorningBriefingVerdictError && error.code === "missing_day1_goal",
  );
  assert.throws(
    () => buildContext({ officeHoursHistory: {}, officeHoursMemorySummary: {} }),
    (error) => error instanceof MorningBriefingVerdictError && error.code === "missing_office_hours",
  );
  const digest = digestFixture();
  digest.sources = digest.sources.filter((source) => source.id !== "posthog");
  assert.throws(
    () => buildContext({ digest }),
    (error) => error instanceof MorningBriefingVerdictError
      && error.code === "missing_source_evidence"
      && error.source === "posthog",
  );
});

test("buildMorningBriefingVerdictPrompt includes aggregate context and redacts raw identifiers", () => {
  const context = buildContext();
  const prompt = buildMorningBriefingVerdictPrompt(context);
  assert.match(prompt, /## Onboarding/);
  assert.match(prompt, /## Day 1 Goal/);
  assert.match(prompt, /## Office Hours/);
  assert.match(prompt, /Cloudflare/);
  assert.match(prompt, /GitHub/);
  assert.match(prompt, /PostHog/);
  assert.match(prompt, /Structured Evidence Claims/);
  assert.match(prompt, /source=proof_ledger/);
  assert.match(prompt, /source=active_users/);
  assert.match(prompt, /class=customer_behavior/);
  assert.match(prompt, /visits=223/);
  assert.match(prompt, /commits=7/);
  assert.match(prompt, /conversions=0/);
  assert.doesNotMatch(prompt, /founder@example\.com/);
  assert.doesNotMatch(prompt, /203\.0\.113\.4/);
  assert.doesNotMatch(prompt, /phx_abcdefghijklmnopqrstuvwxyz/);
});

test("buildMorningBriefingVerdictContext applies phase-aware active user strictness", () => {
  assert.doesNotThrow(() => buildContext({
    currentDay: 13,
    activeUsers: null,
  }));
  assert.throws(
    () => buildContext({
      currentDay: 14,
      activeUsers: { signal: null, collectionStatus: { status: "source_unavailable" } },
    }),
    (error) => error instanceof MorningBriefingVerdictError
      && error.code === "missing_active_users"
      && error.source === "active_users",
  );
  assert.doesNotThrow(() => buildContext({
    currentDay: 14,
    activeUsers: activeUsersFixture({ rowCount: 0 }),
  }));
});

test("evidence bundle admits completed medium customer proof and keeps diagnostics non-proof", () => {
  const bundle = buildMorningBriefingVerdictEvidenceBundle({
    sources: [],
    proofLedger: customerProofLedgerFixture(),
    activeUsers: activeUsersFixture({ rowCount: 1 }),
    evidenceOS: evidenceOsFixture(),
    workHistory: workHistoryFixture(),
    adaptiveRuleSignals: adaptiveRuleSignalsFixture(),
    currentDay: 14,
    now: new Date("2026-06-16T01:00:00.000Z"),
  });
  assert.equal(bundle.requirements.hasCompletedCustomerEvidence, true);
  assert.equal(bundle.requirements.activeUsersSatisfied, true);
  const proofClaim = bundle.claims.find((claim) => claim.sourceId === "proof_ledger" && claim.tier === "proof");
  assert.equal(proofClaim.customerEvidence, true);
  assert.equal(proofClaim.supportsHealthy, true);
  for (const sourceId of ["work_history", "adaptive_rules"]) {
    const claim = bundle.claims.find((candidate) => candidate.sourceId === sourceId);
    assert.equal(claim.customerEvidence, false);
    assert.equal(claim.supportsHealthy, false);
  }
});

test("normalizeMorningBriefingLlmVerdict accepts grounded build and traffic verdicts", () => {
  const context = buildContext();
  const buildVerdict = normalizeMorningBriefingLlmVerdict({
    state: "build_without_customer_evidence",
    title: "빌드 신호는 강하지만 고객 행동 근거가 약해요.",
    body: "Day 1 목표 기준으로 PostHog 전환과 Office Hours 약속 증거를 먼저 닫아야 합니다.",
    primaryActionId: "task",
    evidence: [
      "GitHub commits 7 집계가 있습니다.",
      "PostHog conversions 0 집계가 있습니다.",
      "Office Hours 설치 이후 workspace scan을 완료하는지 확인이 남아 있습니다.",
    ],
  }, { context, provider: "codex", generatedAt: "2026-06-16T00:00:00.000Z" });
  assert.equal(buildVerdict.state, "build_without_customer_evidence");
  assert.equal(buildVerdict.primaryActionId, "task");
  assert.equal(buildVerdict.verdictProvider, "codex");
  assert.ok(isMorningBriefingLlmVerdict({ customerEvidenceVerdict: buildVerdict }));
  assert.equal(isMorningBriefingLlmVerdict({
    customerEvidenceVerdict: {
      ...buildVerdict,
      verdictProvider: "local_fallback",
    },
  }), false);

  const trafficVerdict = normalizeMorningBriefingLlmVerdict({
    state: "traffic_without_activation",
    title: "유입은 있지만 첫 핵심 행동 근거가 비어 있어요.",
    body: "Cloudflare 방문 이후 PostHog 검증 행동까지 이어지는지 오늘 확인해야 합니다.",
    primaryActionId: "message",
    evidence: [
      "Cloudflare visits 223 집계가 있습니다.",
      "PostHog validation_action 0 명 missing 상태입니다.",
    ],
  }, { context, provider: "codex", generatedAt: "2026-06-16T00:00:00.000Z" });
  assert.equal(trafficVerdict.state, "traffic_without_activation");
  assert.equal(trafficVerdict.primaryActionId, "message");
});

test("normalizeMorningBriefingLlmVerdict enforces healthy proof and due-tracking requirements", () => {
  const healthyContext = buildContext({
    currentDay: 14,
    proofLedger: customerProofLedgerFixture(),
    activeUsers: activeUsersFixture({ rowCount: 1 }),
    evidenceOS: evidenceOsFixture(),
  });
  const verdict = normalizeMorningBriefingLlmVerdict({
    state: "healthy",
    title: "고객 증거와 핵심 행동 측정이 함께 확인됐어요.",
    body: "오늘은 같은 고객군에서 다음 검증 행동으로 넓혀도 됩니다.",
    primaryActionId: "experiment",
    evidence: [
      "proof_ledger Proof Ledger completed medium+ customer evidence count 1",
      "active_users Active Users first_value unique users 1",
    ],
  }, { context: healthyContext, provider: "codex", generatedAt: "2026-06-16T00:00:00.000Z" });
  assert.equal(verdict.state, "healthy");

  assert.throws(
    () => normalizeMorningBriefingLlmVerdict({
      state: "healthy",
      title: "고객 증거가 충분해요.",
      body: "오늘은 다음 실험으로 갑니다.",
      primaryActionId: "experiment",
      evidence: [
        "GitHub commits 7 집계가 있습니다.",
        "PostHog conversions 0 집계가 있습니다.",
      ],
    }, { context: buildContext(), provider: "codex" }),
    (error) => error instanceof MorningBriefingVerdictError
      && error.code === "invalid_healthy"
      && error.reasons.includes("completed_customer_evidence_missing"),
  );

  assert.throws(
    () => normalizeMorningBriefingLlmVerdict({
      state: "healthy",
      title: "고객 증거는 있지만 게이트가 잠겨 있어요.",
      body: "오늘은 잠긴 조건을 먼저 닫아야 합니다.",
      primaryActionId: "task",
      evidence: [
        "proof_ledger Proof Ledger completed medium+ customer evidence count 1",
        "program_gates Program Gate G4 blocked first_value_observed",
      ],
    }, {
      context: buildContext({
        currentDay: 14,
        proofLedger: customerProofLedgerFixture(),
        activeUsers: activeUsersFixture({ rowCount: 1 }),
        programGateEvaluation: blockedGateEvaluationFixture(),
      }),
      provider: "codex",
    }),
    (error) => error instanceof MorningBriefingVerdictError
      && error.code === "invalid_healthy"
      && error.reasons.includes("gate_blocked"),
  );
});

test("normalizeMorningBriefingLlmVerdict rejects unsupported or ungrounded output", () => {
  const context = buildContext();
  assert.throws(
    () => normalizeMorningBriefingLlmVerdict({
      state: "looks_good",
      title: "근거가 충분해요.",
      body: "오늘은 계속합니다.",
      primaryActionId: "task",
      evidence: ["GitHub commits 7 집계가 있습니다.", "PostHog conversions 0 집계가 있습니다."],
    }, { context, provider: "codex" }),
    (error) => error instanceof MorningBriefingVerdictError && error.code === "invalid_state",
  );
  assert.throws(
    () => normalizeMorningBriefingLlmVerdict({
      state: "healthy",
      title: "근거가 충분해요.",
      body: "오늘은 계속합니다.",
      primaryActionId: "paywall",
      evidence: ["GitHub commits 7 집계가 있습니다.", "PostHog conversions 0 집계가 있습니다."],
    }, { context, provider: "codex" }),
    (error) => error instanceof MorningBriefingVerdictError && error.code === "invalid_action",
  );
  assert.throws(
    () => normalizeMorningBriefingLlmVerdict({
      state: "build_without_customer_evidence",
      title: "결제가 충분히 확인됐어요.",
      body: "오늘은 확장하면 됩니다.",
      primaryActionId: "experiment",
      evidence: ["Stripe 결제 10건이 있습니다.", "유료 계약 3건이 있습니다."],
    }, { context, provider: "codex" }),
    (error) => error instanceof MorningBriefingVerdictError && error.code === "ungrounded_evidence",
  );
  assert.throws(
    () => normalizeMorningBriefingLlmVerdict({
      state: "instrumentation_gap",
      title: "activation 계측이 필요해요.",
      body: "오늘은 검증 행동을 확인합니다.",
      primaryActionId: "task",
      evidence: ["GitHub commits 7 집계가 있습니다.", "PostHog conversions 0 집계가 있습니다."],
    }, { context, provider: "codex" }),
    (error) => error instanceof MorningBriefingVerdictError && error.code === "unsafe_output",
  );
});

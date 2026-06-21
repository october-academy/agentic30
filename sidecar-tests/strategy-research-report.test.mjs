import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  STRATEGY_REPORT_ADVERSARIAL_OUTPUT_SCHEMA_NAME,
  STRATEGY_REPORT_OUTPUT_SCHEMA_NAME,
  STRATEGY_REPORT_PROGRESS_STEPS,
  STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS,
  STRATEGY_REPORT_STRUCTURED_OUTPUT_FAILURE_PROVIDER_SCHEMA_INVALID_LOCAL,
  assertStrategyReportProviderJsonSchema,
  buildStrategyReportProviderJsonSchema,
  buildStrategyReportProgressStatus,
  loadStrategyReportSnapshot,
  refreshStrategyReport,
  resolveStrategyReportCachePath,
  resolveStrategyReportRunsDir,
} from "../sidecar/strategy-research-report.mjs";
import {
  DIRECT_EXA_API_KEY_REQUIRED_REASON,
  DIRECT_EXA_SEARCH_FAILED_REASON,
} from "../sidecar/direct-exa-research.mjs";

async function withTmpWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-strategy-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function exaRoute() {
  return {
    provider: "codex",
    label: "Codex Exa MCP",
    mcpConfig: {
      type: "http",
      url: "https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa,web_fetch_exa",
      headers: { "x-api-key": "exa_test_key" },
    },
  };
}

const REQUIRED_CANVAS_BLOCK_IDS = [
  "partners",
  "activities",
  "resources",
  "value-proposition",
  "relationships",
  "channels",
  "customer-segments",
  "cost-structure",
  "revenue-streams",
];

function completeReport(overrides = {}) {
  return {
    commandLine: "strategy@agentic30 ~/code/agentic30 $ synthesize dynamic-strategy --from exa SPEC ICP VALUES",
    diagnosisKicker: "Business diagnosis",
    diagnosisTitle: "Agentic30은 코딩 도구가 아니라 1인 개발자의 paid ask와 first_value 증거를 닫는 evidence assistant입니다.",
    diagnosisLead: "공개 리서치, 경쟁 리뷰, 검증 패스를 종합하면 차별점은 빌드 속도가 아니라 로컬 실행 기록을 고객 행동 증거로 바꾸는 루프입니다.",
    positioningStatement: "Agentic30은 혼자 일하는 개발자가 매일 프로젝트 기록을 paid ask와 first_value 실험으로 바꾸는 macOS evidence assistant입니다.",
    judgement: "전략 판단은 private pilot에서 가격 ask와 activation 증거를 좁히고, 코딩 도구 경쟁이 아닌 PMF 증거 루프 카테고리를 고수하는 것입니다.",
    generatedBadge: "동적 리서치",
    analysisBasisLabel: "SPEC.md + ICP.md + VALUES.md + Exa public evidence",
    summaryTiles: [
      { id: "primary-icp", label: "Primary ICP", title: "전업 1인 개발자", detail: "첫 매출 전, macOS와 AI 코딩 도구를 쓰며 기록 제출 의향이 있습니다." },
      { id: "wedge", label: "Wedge", title: "Local evidence loop", detail: "업무 기록에서 오늘의 paid ask와 first_value 목표를 만듭니다." },
      { id: "proof-target", label: "Proof target", title: "고객 행동 증거", detail: "인터뷰 원문, 유료 ask, activation, Go/No-Go 결정을 연결합니다." },
    ],
    criteriaRows: [
      { id: "product-shape", label: "제품 형태", value: "SwiftUI macOS 메뉴바 앱 + 로컬 Node sidecar + 선택적 외부 근거 리서치입니다." },
      { id: "core-pain", label: "핵심 고통", value: "AI 코딩으로 만들 수는 있지만 누구에게 얼마로 팔지 모릅니다." },
      { id: "differentiator", label: "차별 기준", value: "정적 강의가 아니라 로컬 실행 기록에서 adaptive Day 과제와 evidence gate를 생성합니다." },
      { id: "stage", label: "현재 단계", value: "private pilot evidence와 외부 ICP 반응을 추적하는 단계입니다." },
    ],
    canvasBlocks: [
      { id: "partners", number: "08", eyebrow: "Partners", title: "핵심 파트너", tone: "blue", bullets: ["Claude / Codex / Cursor / Gemini 같은 AI coding provider 생태계", "PostHog, GitHub, Cloudflare에서 읽는 activation evidence"] },
      { id: "activities", number: "07", eyebrow: "Activities", title: "핵심 활동", tone: "accent", bullets: ["Foundation Day 0-3 dogfood와 private pilot 반복", "프로젝트/업무/인터뷰/BIP/PostHog 기록에서 다음 과제 생성"] },
      { id: "resources", number: "06", eyebrow: "Resources", title: "핵심 자원", tone: "sky", bullets: ["로컬 실행 로그와 proof-ledger", "SPEC / ICP / VALUES 전략 문서"] },
      { id: "value-proposition", number: "02", eyebrow: "Value proposition", title: "가치 제안", tone: "accent", bullets: ["오늘 보낼 paid ask와 측정할 first_value를 좁힙니다.", "혼자 판단하는 편향을 transcript, BIP, PostHog 숫자로 교정합니다."] },
      { id: "relationships", number: "04", eyebrow: "Relationships", title: "고객 관계", tone: "accent", bullets: ["메뉴바 상주 assistant의 매일 체크인", "private pilot에서 맞춤 작업과 강한 피드백 루프"] },
      { id: "channels", number: "03", eyebrow: "Channels", title: "채널", tone: "blue", bullets: ["Threads / Discord / indie founder 커뮤니티", "직접 사이트프로젝트를 가진 1인 개발자 referral"] },
      { id: "customer-segments", number: "01", eyebrow: "Customer segments", title: "고객 세그먼트", tone: "accent", bullets: ["전업 1인 개발자, 첫 매출 전, macOS 사용자", "AI 코딩 도구 사용 경험이 있는 builder"] },
      { id: "cost-structure", number: "09", eyebrow: "Cost structure", title: "비용 구조", tone: "magenta", bullets: ["provider execution 비용과 macOS 배포/지원 비용", "리서치/검증 패스의 시간 비용"] },
      { id: "revenue-streams", number: "05", eyebrow: "Revenue streams", title: "수익원", tone: "accent", bullets: ["pilot 유료 ask", "월 구독형 개인 evidence assistant"] },
    ],
    competitors: [
      { id: "agentic30", title: "Agentic30", tag: "Adaptive PMF evidence loop", body: "내 프로젝트 기록을 읽어 오늘의 유료 ask와 증거 gate를 만듭니다.", gap: "검증 과제: 유료 pilot에서 first_value를 반복 입증해야 합니다.", x: 0.78, y: 0.22, adaptiveScore: 92, evidenceScore: 84, sourceLabel: "SPEC / ICP / Exa", sourceURL: "https://agentic30.com", sourceDisplay: "agentic30.com", verifiedAt: "2026-06", scoreRationale: "로컬 기록 기반 adaptive 과제와 evidence gate가 함께 있습니다.", category: "agentic30", isAgentic30: true, labelPlacement: "leading" },
      { id: "cursor", title: "Cursor", tag: "AI coding workspace", body: "빌드 속도는 높지만 PMF 증거 루프는 제품 밖에 있습니다.", gap: "Agentic30은 코딩 생산성 대신 고객 행동 증거를 닫습니다.", x: 0.72, y: 0.72, adaptiveScore: 80, evidenceScore: 35, sourceLabel: "Public docs", sourceURL: "https://cursor.com", sourceDisplay: "cursor.com", verifiedAt: "2026-06", scoreRationale: "코딩 적응성은 강하지만 paid ask 추적은 핵심 제품이 아닙니다.", category: "aiBuild", isAgentic30: false, labelPlacement: "trailing" },
      { id: "indiefounders", title: "IndieFounders", tag: "Founder community", body: "창업자 네트워크와 학습 콘텐츠는 있으나 로컬 evidence loop는 약합니다.", gap: "Agentic30은 커뮤니티가 아니라 매일 실행 기록에 붙습니다.", x: 0.32, y: 0.38, adaptiveScore: 42, evidenceScore: 58, sourceLabel: "Public site", sourceURL: "https://indiefounders.net", sourceDisplay: "indiefounders.net", verifiedAt: "2026-06", scoreRationale: "커뮤니티 증거는 있으나 제품 실행 자동화는 제한적입니다.", category: "community", isAgentic30: false, labelPlacement: "leading" },
    ],
    swotGroups: [
      { id: "strengths", title: "Strengths", tag: "내부 강점", tone: "accent", bullets: ["로컬 기록 기반 맥락", "매일 evidence gate로 이어지는 루프"] },
      { id: "weaknesses", title: "Weaknesses", tag: "내부 약점", tone: "magenta", bullets: ["초기 데이터 밀도가 낮음", "macOS 한정 배포"] },
      { id: "opportunities", title: "Opportunities", tag: "외부 기회", tone: "sky", bullets: ["AI coding tool 보급", "1인 개발자 monetization 니즈"] },
      { id: "threats", title: "Threats", tag: "외부 위협", tone: "blue", bullets: ["대형 coding IDE의 workflow 흡수", "전략 리포트만으로 보이는 위험"] },
    ],
    swotMatrixColumnCount: 2,
    swotMatrixRows: [["strengths", "weaknesses"], ["opportunities", "threats"]],
    sourceRefs: [
      { id: "cursor", sourceType: "public_web", title: "Cursor", url: "https://cursor.com", domain: "cursor.com", excerpt: "AI coding workspace reference" },
    ],
    ...overrides,
  };
}

function competitorFixture(index, overrides = {}) {
  return {
    id: `competitor-${index}`,
    title: `Competitor ${index}`,
    tag: "Adjacent strategy tool",
    body: `Competitor ${index} is a synthetic public matrix fixture used to exercise report normalization.`,
    gap: "Agentic30 should stay focused on local execution evidence rather than this adjacent workflow.",
    adaptiveScore: 30 + (index % 50),
    evidenceScore: 20 + (index % 60),
    sourceLabel: "Fixture public source",
    sourceURL: `https://example.com/competitor-${index}`,
    sourceDisplay: `example.com/competitor-${index}`,
    verifiedAt: "2026-06",
    scoreRationale: "Fixture row has complete matrix scores and source metadata.",
    category: "other",
    isAgentic30: false,
    labelPlacement: "trailing",
    ...overrides,
  };
}

function collectEmptySchemaObjectPaths(value, path = "<root>") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectEmptySchemaObjectPaths(item, `${path}[${index}]`));
  }
  const keys = Object.keys(value);
  const nested = Object.entries(value)
    .flatMap(([key, child]) => collectEmptySchemaObjectPaths(child, `${path}.${key}`));
  return keys.length === 0 ? [path, ...nested] : nested;
}

function collectAdditionalPropertiesValues(value, path = "<root>") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectAdditionalPropertiesValues(item, `${path}[${index}]`));
  }
  const own = Object.hasOwn(value, "additionalProperties")
    ? [{ path: `${path}.additionalProperties`, value: value.additionalProperties }]
    : [];
  return [
    ...own,
    ...Object.entries(value).flatMap(([key, child]) => collectAdditionalPropertiesValues(child, `${path}.${key}`)),
  ];
}

function collectMissingRequiredPropertyKeys(value, path = "<root>") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectMissingRequiredPropertyKeys(item, `${path}[${index}]`));
  }
  const own = [];
  if (
    value.type === "object"
    && value.properties
    && typeof value.properties === "object"
    && !Array.isArray(value.properties)
  ) {
    const required = Array.isArray(value.required) ? value.required : [];
    const missing = Object.keys(value.properties).filter((key) => !required.includes(key));
    if (missing.length > 0) {
      own.push({ path, missing });
    }
  }
  return [
    ...own,
    ...Object.entries(value).flatMap(([key, child]) => collectMissingRequiredPropertyKeys(child, `${path}.${key}`)),
  ];
}

test("strategy report provider JSON schema preserves competitor bounds", () => {
  const schema = buildStrategyReportProviderJsonSchema("codex");
  const report = schema.properties.report;
  const competitors = report.properties.competitors;

  assert.equal(competitors.minItems, STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS.competitorsMinItems);
  assert.equal(competitors.maxItems, STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS.competitorsMaxItems);
  assert.equal(schema.required.includes("report"), true);
  assert.deepEqual(report.properties.canvasBlocks.items.required, ["id", "title", "bullets"]);
  assert.deepEqual(competitors.items.required, [
    "id",
    "title",
    "tag",
    "body",
    "gap",
    "adaptiveScore",
    "evidenceScore",
    "sourceLabel",
    "sourceURL",
    "sourceDisplay",
    "scoreRationale",
    "isAgentic30",
  ]);
  assert.equal(Object.hasOwn(schema, "$schema"), false);
  assert.deepEqual(collectEmptySchemaObjectPaths(schema), []);
  assert.deepEqual(collectMissingRequiredPropertyKeys(schema), []);
  assert.equal(
    collectAdditionalPropertiesValues(schema).every((entry) => entry.value === false),
    true,
  );
});

test("strategy report Gemini JSON schema sanitizer keeps required object and array limits", () => {
  const schema = buildStrategyReportProviderJsonSchema("gemini");
  const report = schema.properties.report;
  const competitors = report.properties.competitors;

  assert.equal(schema.type, "object");
  assert.equal(schema.required.includes("report"), true);
  assert.equal(Object.hasOwn(report, "additionalProperties"), true);
  assert.equal(report.additionalProperties, false);
  assert.equal(report.required.includes("competitors"), true);
  assert.equal(competitors.minItems, 3);
  assert.equal(competitors.maxItems, 12);
  assert.deepEqual(collectEmptySchemaObjectPaths(schema), []);
  assert.deepEqual(collectMissingRequiredPropertyKeys(schema), []);
  assert.equal(
    collectAdditionalPropertiesValues(schema).every((entry) => entry.value === false),
    true,
  );
});

test("strategy report provider JSON schema preflight rejects schemas unsafe for provider strict mode", () => {
  assert.throws(
    () => assertStrategyReportProviderJsonSchema({
      type: "object",
      properties: {
        report: {},
      },
      required: ["report"],
      additionalProperties: false,
    }, { provider: "codex", schemaName: "BrokenReportContract" }),
    (error) => (
      error.structuredOutputFailure === STRATEGY_REPORT_STRUCTURED_OUTPUT_FAILURE_PROVIDER_SCHEMA_INVALID_LOCAL
      && /empty schema object/.test(error.message)
    ),
  );

  assert.throws(
    () => assertStrategyReportProviderJsonSchema({
      type: "object",
      properties: {
        report: { type: "object", properties: {}, required: [], additionalProperties: {} },
      },
      required: ["report"],
      additionalProperties: false,
    }, { provider: "codex", schemaName: "BrokenAdditionalPropertiesContract" }),
    (error) => (
      error.structuredOutputFailure === STRATEGY_REPORT_STRUCTURED_OUTPUT_FAILURE_PROVIDER_SCHEMA_INVALID_LOCAL
      && /additionalProperties/.test(error.message)
    ),
  );

  assert.throws(
    () => assertStrategyReportProviderJsonSchema({
      type: "object",
      properties: {
        report: {
          type: "object",
          properties: {
            title: { type: "string" },
            optionalSubtitle: { type: "string" },
          },
          required: ["title"],
          additionalProperties: false,
        },
      },
      required: ["report"],
      additionalProperties: false,
    }, { provider: "codex", schemaName: "BrokenRequiredContract" }),
    (error) => (
      error.structuredOutputFailure === STRATEGY_REPORT_STRUCTURED_OUTPUT_FAILURE_PROVIDER_SCHEMA_INVALID_LOCAL
      && /missing required keys optionalSubtitle/.test(error.message)
    ),
  );
});

test("strategy report fails closed when Exa route is unavailable", async () => {
  await withTmpWorkspace(async (root) => {
    let called = false;
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [],
      providerResearcher: async () => {
        called = true;
        return { text: "{}" };
      },
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(called, false);
    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.status.reason, DIRECT_EXA_API_KEY_REQUIRED_REASON);
    assert.match(snapshot.status.error, /direct Exa Search 연결 키/);
    assert.equal(snapshot.report, null);
  });
});

test("strategy report fails fast when Exa route has no direct API key", async () => {
  await withTmpWorkspace(async (root) => {
    let called = false;
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [{
        provider: "codex",
        label: "Codex Exa MCP",
        mcpConfig: {
          type: "http",
          url: "https://mcp.exa.ai/mcp",
        },
      }],
      providerResearcher: async () => {
        called = true;
        return { text: "{}" };
      },
      adversarialReviewer: async () => ({ text: "{}" }),
      multidimensionalVerifier: async () => ({ text: "{}" }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(called, false);
    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.status.reason, DIRECT_EXA_API_KEY_REQUIRED_REASON);
    assert.match(snapshot.status.error, /direct Exa Search 연결 키/);
    assert.equal(snapshot.report, null);
  });
});

test("strategy report reuses fresh cache before checking missing direct Exa key", async () => {
  await withTmpWorkspace(async (root) => {
    let calls = 0;
    const first = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => {
        calls += 1;
        return { text: JSON.stringify({ report: completeReport() }), provider: "codex", researchSource: "Codex Exa MCP" };
      },
      adversarialReviewer: async () => {
        calls += 1;
        return { text: JSON.stringify({ verdict: "pass", findings: [], requiredChanges: [] }) };
      },
      multidimensionalVerifier: async () => {
        calls += 1;
        return { text: JSON.stringify({ report: completeReport() }) };
      },
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    const second = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [{
        provider: "codex",
        label: "Codex Exa MCP",
        mcpConfig: {
          type: "http",
          url: "https://mcp.exa.ai/mcp",
        },
      }],
      force: false,
      providerResearcher: async () => {
        calls += 1;
        return { text: "{}" };
      },
      adversarialReviewer: async () => {
        calls += 1;
        return { text: "{}" };
      },
      multidimensionalVerifier: async () => {
        calls += 1;
        return { text: "{}" };
      },
      now: new Date("2026-06-14T01:00:00.000Z"),
    });

    assert.equal(calls, 3);
    assert.equal(first.status.state, "ready");
    assert.equal(second.status.state, "ready");
    assert.equal(second.generatedAt, first.generatedAt);
    assert.equal(second.contextFingerprint, first.contextFingerprint);
  });
});

test("strategy report preserves typed direct Exa search failure reason", async () => {
  await withTmpWorkspace(async (root) => {
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => {
        const error = new Error("Exa Search API returned no usable evidence. Exa Search API 401: {\"error\":\"Invalid API key\",\"tag\":\"INVALID_API_KEY\"}");
        error.reason = DIRECT_EXA_SEARCH_FAILED_REASON;
        error.code = DIRECT_EXA_SEARCH_FAILED_REASON;
        error.failures = [{
          query: "Agentic30 alternatives",
          reason: DIRECT_EXA_SEARCH_FAILED_REASON,
          error: "Exa Search API 401: {\"error\":\"Invalid API key\",\"tag\":\"INVALID_API_KEY\"}",
        }];
        throw error;
      },
      adversarialReviewer: async () => ({ text: "{}" }),
      multidimensionalVerifier: async () => ({ text: "{}" }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.status.reason, DIRECT_EXA_SEARCH_FAILED_REASON);
    assert.match(snapshot.status.error, /Exa Search API 호출이 실패했습니다/);
    assert.match(snapshot.status.error, /Invalid API key/);
    assert.doesNotMatch(snapshot.status.error, /\[redacted-private\]/);
  });
});

test("strategy report direct Exa failure summary does not bypass private text redaction", async () => {
  await withTmpWorkspace(async (root) => {
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => {
        const error = new Error("Exa Search API returned no usable evidence.");
        error.reason = DIRECT_EXA_SEARCH_FAILED_REASON;
        error.code = DIRECT_EXA_SEARCH_FAILED_REASON;
        error.failures = [{
          query: "private test",
          reason: DIRECT_EXA_SEARCH_FAILED_REASON,
          error: "Exa Search API 401: {\"error\":\"Invalid API key\"}; interview transcript says founder@example.com",
        }];
        throw error;
      },
      adversarialReviewer: async () => ({ text: "{}" }),
      multidimensionalVerifier: async () => ({ text: "{}" }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.status.reason, DIRECT_EXA_SEARCH_FAILED_REASON);
    assert.equal(snapshot.status.error, "[redacted-private]");
  });
});

test("strategy report executes research, adversarial review, and multidimensional verification in order", async () => {
  await withTmpWorkspace(async (root) => {
    const calls = [];
    const progressStages = [];
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async ({
        mode,
        prompt,
        exaResearchRoute,
        exaResearchRoutes,
        onProgress,
      }) => {
        calls.push(mode);
        assert.match(prompt, /Exa public research pass/);
        assert.match(prompt, /Structured output contract/);
        assert.match(prompt, /summaryTiles: 3-6 items/);
        assert.equal(exaResearchRoute.label, "Codex Exa MCP");
        assert.equal(exaResearchRoutes[0].label, "Codex Exa MCP");
        assert.equal(exaResearchRoutes[0].mcpConfig.type, "http");
        assert.equal(exaResearchRoutes[0].mcpConfig.headers["x-api-key"], "exa_test_key");
        assert.equal(typeof onProgress, "function");
        return { text: JSON.stringify({ report: completeReport() }), provider: "codex", researchSource: "Codex Exa MCP" };
      },
      adversarialReviewer: async ({ mode, prompt, candidateReport }) => {
        calls.push(mode);
        assert.match(prompt, /Adversarial strategy review/);
        assert.equal(candidateReport.positioningStatement.includes("Agentic30"), true);
        return { text: JSON.stringify({ verdict: "pass_with_edits", findings: ["PMF evidence risk"], requiredChanges: ["tighten ICP"] }) };
      },
      multidimensionalVerifier: async ({ mode, prompt, adversarialReview }) => {
        calls.push(mode);
        assert.match(prompt, /Multidimensional final verification/);
        assert.match(prompt, /Structured output contract/);
        assert.match(prompt, /summaryTiles: 3-6 items/);
        assert.equal(adversarialReview.verdict, "pass_with_edits");
        return { text: JSON.stringify({ report: completeReport({ diagnosisKicker: "Verified diagnosis" }) }) };
      },
      onProgress: (progress) => progressStages.push(progress.stage),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.deepEqual(calls, ["exa_research", "adversarial_review", "multidimensional_verification"]);
    assert.deepEqual(progressStages, STRATEGY_REPORT_PROGRESS_STEPS.map((step) => step.stage));
    assert.equal(snapshot.status.state, "ready");
    assert.equal(snapshot.report.diagnosisKicker, "Verified diagnosis");
    assert.equal(snapshot.report.competitors.find((competitor) => competitor.id === "agentic30").isAgentic30, true);
  });
});

test("strategy report forwards structured output schemas to provider passes and logs metadata", async () => {
  await withTmpWorkspace(async (root) => {
    const seen = {};
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [{
        ...exaRoute(),
        provider: "gemini",
        label: "Gemini Exa MCP",
      }],
      force: true,
      providerResearcher: async (args) => {
        seen[args.mode] = args;
        return {
          text: JSON.stringify({ report: completeReport() }),
          provider: "gemini",
          researchSource: "Gemini Exa MCP",
        };
      },
      adversarialReviewer: async (args) => {
        seen[args.mode] = args;
        return {
          text: JSON.stringify({ verdict: "pass", findings: ["구조화 출력 검증 통과"], requiredChanges: [] }),
          provider: "gemini",
          researchSource: "gemini synthesis",
        };
      },
      multidimensionalVerifier: async (args) => {
        seen[args.mode] = args;
        return {
          text: JSON.stringify({ report: completeReport({ judgement: "구조화 출력 검증" }) }),
          provider: "gemini",
          researchSource: "gemini synthesis",
        };
      },
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "ready");
    assert.equal(seen.exa_research.structuredOutputSchemaName, STRATEGY_REPORT_OUTPUT_SCHEMA_NAME);
    assert.equal(
      assertStrategyReportProviderJsonSchema(seen.exa_research.structuredOutputSchema, {
        provider: "gemini",
        schemaName: STRATEGY_REPORT_OUTPUT_SCHEMA_NAME,
      }),
      seen.exa_research.structuredOutputSchema,
    );
    assert.equal(
      seen.exa_research.structuredOutputSchema.properties.report.properties.competitors.maxItems,
      STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS.competitorsMaxItems,
    );
    assert.equal(seen.exa_research.structuredOutputSchemaLimits.competitorsMaxItems, 12);
    assert.equal(seen.adversarial_review.structuredOutputSchemaName, STRATEGY_REPORT_ADVERSARIAL_OUTPUT_SCHEMA_NAME);
    assert.equal(
      assertStrategyReportProviderJsonSchema(seen.adversarial_review.structuredOutputSchema, {
        provider: "gemini",
        schemaName: STRATEGY_REPORT_ADVERSARIAL_OUTPUT_SCHEMA_NAME,
      }),
      seen.adversarial_review.structuredOutputSchema,
    );
    assert.equal(seen.adversarial_review.structuredOutputSchema.properties.verdict.type, "string");
    assert.equal(seen.adversarial_review.structuredOutputSchemaLimits, null);
    assert.equal(seen.multidimensional_verification.structuredOutputSchemaName, STRATEGY_REPORT_OUTPUT_SCHEMA_NAME);

    const cache = JSON.parse(await fs.readFile(resolveStrategyReportCachePath(root), "utf8"));
    assert.equal(cache.rawProviderResult.passes.length, 3);
    assert.equal(cache.rawProviderResult.passes.every((pass) => pass.structuredOutputRequested), true);
    assert.equal(cache.rawProviderResult.passes[0].structuredOutputProvider, "gemini");
    assert.equal(cache.rawProviderResult.passes[0].structuredOutputSchemaName, STRATEGY_REPORT_OUTPUT_SCHEMA_NAME);
    assert.deepEqual(
      cache.rawProviderResult.passes[0].structuredOutputSchemaLimits,
      STRATEGY_REPORT_STRUCTURED_OUTPUT_LIMITS,
    );
    assert.equal(cache.rawProviderResult.passes[1].structuredOutputSchemaName, STRATEGY_REPORT_ADVERSARIAL_OUTPUT_SCHEMA_NAME);
    assert.equal(cache.rawProviderResult.passes[1].structuredOutputSchemaLimits, null);
    assert.equal(cache.rawProviderResult.passes[2].structuredOutputSchemaName, STRATEGY_REPORT_OUTPUT_SCHEMA_NAME);
  });
});

test("strategy report fails closed on invalid structured output JSON text", async () => {
  await withTmpWorkspace(async (root) => {
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({
        text: `provider preface ${JSON.stringify({ report: completeReport() })}`,
        provider: "codex",
        researchSource: "Codex Exa MCP",
      }),
      adversarialReviewer: async () => {
        throw new Error("should not run");
      },
      multidimensionalVerifier: async () => {
        throw new Error("should not run");
      },
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.report, null);
    assert.match(snapshot.status.error, /structured output was not valid JSON text/);

    const cache = JSON.parse(await fs.readFile(resolveStrategyReportCachePath(root), "utf8"));
    assert.equal(cache.rawProviderResult.passes[0].structuredOutputRequested, true);
    assert.equal(cache.rawProviderResult.passes[0].structuredOutputFailure, "invalid_json_text");
    assert.equal(cache.rawProviderResult.passes[0].structuredOutputSchemaName, STRATEGY_REPORT_OUTPUT_SCHEMA_NAME);
    assert.equal(cache.rawProviderResult.passes[1].textChars, 0);
  });
});

test("strategy report fails before provider call when local provider schema preflight fails", async () => {
  await withTmpWorkspace(async (root) => {
    let providerCalled = false;
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerJsonSchemaBuilder: () => ({
        type: "object",
        properties: {
          report: {},
        },
        required: ["report"],
        additionalProperties: false,
      }),
      providerResearcher: async () => {
        providerCalled = true;
        return { text: JSON.stringify({ report: completeReport() }) };
      },
      adversarialReviewer: async () => {
        throw new Error("should not run");
      },
      multidimensionalVerifier: async () => {
        throw new Error("should not run");
      },
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(providerCalled, false);
    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.report, null);
    assert.equal(snapshot.status.reason, STRATEGY_REPORT_STRUCTURED_OUTPUT_FAILURE_PROVIDER_SCHEMA_INVALID_LOCAL);
    assert.match(snapshot.status.error, /provider JSON schema invalid locally/);

    const cache = JSON.parse(await fs.readFile(resolveStrategyReportCachePath(root), "utf8"));
    assert.equal(cache.rawProviderResult.passes[0].structuredOutputRequested, true);
    assert.equal(
      cache.rawProviderResult.passes[0].structuredOutputFailure,
      STRATEGY_REPORT_STRUCTURED_OUTPUT_FAILURE_PROVIDER_SCHEMA_INVALID_LOCAL,
    );
    assert.equal(cache.rawProviderResult.passes[0].textChars, 0);
  });
});

test("strategy report preserves provider schema rejection as provider_schema_rejected", async () => {
  await withTmpWorkspace(async (root) => {
    let providerCalled = false;
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => {
        providerCalled = true;
        const error = new Error("Invalid schema for response_format 'codex_output_schema'");
        error.structuredOutputFailure = "provider_schema_rejected";
        throw error;
      },
      adversarialReviewer: async () => {
        throw new Error("should not run");
      },
      multidimensionalVerifier: async () => {
        throw new Error("should not run");
      },
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(providerCalled, true);
    assert.equal(snapshot.status.state, "failed");
    assert.match(snapshot.status.error, /Invalid schema for response_format/);

    const cache = JSON.parse(await fs.readFile(resolveStrategyReportCachePath(root), "utf8"));
    assert.equal(cache.rawProviderResult.passes[0].structuredOutputRequested, true);
    assert.equal(cache.rawProviderResult.passes[0].structuredOutputFailure, "provider_schema_rejected");
  });
});

test("strategy report normalizes competitor score scales into 0-100 matrix coordinates", async () => {
  await withTmpWorkspace(async (root) => {
    const scaledCompetitors = [
      {
        ...completeReport().competitors[0],
        adaptiveScore: 0.9,
        evidenceScore: 0.84,
      },
      {
        ...completeReport().competitors[1],
        adaptive_score: "8 / 10",
        evidence_score: 3.5,
        adaptiveScore: undefined,
        evidenceScore: undefined,
      },
      {
        ...completeReport().competitors[2],
        adaptiveScore: 4,
        evidenceScore: 5,
      },
    ];

    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({
        text: JSON.stringify({ report: completeReport({ competitors: scaledCompetitors }) }),
        provider: "codex",
        researchSource: "Codex Exa MCP",
      }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({
        text: JSON.stringify({ report: completeReport({ competitors: scaledCompetitors }) }),
      }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "ready");
    const competitorsByID = new Map(snapshot.report.competitors.map((competitor) => [competitor.id, competitor]));
    assert.deepEqual(
      {
        adaptiveScore: competitorsByID.get("agentic30").adaptiveScore,
        evidenceScore: competitorsByID.get("agentic30").evidenceScore,
        x: competitorsByID.get("agentic30").x,
        y: competitorsByID.get("agentic30").y,
      },
      { adaptiveScore: 90, evidenceScore: 84, x: 0.9, y: 0.16 },
    );
    assert.deepEqual(
      {
        adaptiveScore: competitorsByID.get("cursor").adaptiveScore,
        evidenceScore: competitorsByID.get("cursor").evidenceScore,
        x: competitorsByID.get("cursor").x,
        y: competitorsByID.get("cursor").y,
      },
      { adaptiveScore: 80, evidenceScore: 35, x: 0.8, y: 0.65 },
    );
    assert.deepEqual(
      {
        adaptiveScore: competitorsByID.get("indiefounders").adaptiveScore,
        evidenceScore: competitorsByID.get("indiefounders").evidenceScore,
        x: competitorsByID.get("indiefounders").x,
        y: competitorsByID.get("indiefounders").y,
      },
      { adaptiveScore: 40, evidenceScore: 50, x: 0.4, y: 0.5 },
    );
  });
});

test("strategy report fills cached competitor source URLs from strategy data hints", async () => {
  await withTmpWorkspace(async (root) => {
    const strategyDir = path.join(root, "docs", "strategy");
    await fs.mkdir(strategyDir, { recursive: true });
    await fs.writeFile(
      path.join(strategyDir, "agentic30-business-strategy-data.md"),
      [
        "| Competitor | source | verifiedAt | evidenceType | publicSafeSummary | strategyImplication |",
        "|---|---|---|---|---|---|",
        "| Tekk | https://tekk.coach/ | 2026-06-18 | public_competitor | Codebase-first AI CTO/spec agent. | PMF evidence remains outside the loop. |",
        "| pre.dev | https://pre.dev/ | 2026-06-18 | public_competitor | AI CTO/dev-team agent. | Evidence target is working software. |",
      ].join("\n"),
    );

    const cachedReport = completeReport({
      competitors: [
        completeReport().competitors[0],
        {
          ...competitorFixture(2),
          id: "tekk-coach",
          title: "Tekk.coach",
          sourceLabel: "후보 제공 Tekk.coach 요약",
          sourceURL: "",
          sourceDisplay: "",
        },
        {
          ...competitorFixture(3),
          id: "pre-dev",
          title: "pre.dev",
          sourceLabel: "후보 제공 Indie Hackers 요약",
          sourceURL: "",
          sourceDisplay: "",
        },
        {
          ...competitorFixture(4),
          id: "nanocorp",
          title: "Nanocorp",
          sourceLabel: "후보 제공 리뷰 요약",
          sourceURL: "file:///tmp/nanocorp",
          sourceDisplay: "nanocorp fixture",
        },
      ],
    });
    const cachePath = resolveStrategyReportCachePath(root);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "2026-06-21T00:00:00.000Z",
        snapshot: {
          schemaVersion: 1,
          promptProfile: "ko_strategy_report_v1_three_pass_exa",
          contentLocale: "ko-KR",
          generatedAt: "2026-06-21T00:00:00.000Z",
          nextRefreshAfter: "2026-06-22T00:00:00.000Z",
          contextFingerprint: "cached-empty-url-fixture",
          status: {
            state: "ready",
            stale: false,
            error: null,
            reason: "manual",
          },
          workspaceEvidenceRefs: [],
          report: cachedReport,
        },
        rawProviderResult: null,
      }),
    );

    const snapshot = await loadStrategyReportSnapshot({
      workspaceRoot: root,
      exaConfigured: true,
      now: new Date("2026-06-21T01:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "ready");
    const competitorsByID = new Map(snapshot.report.competitors.map((competitor) => [competitor.id, competitor]));
    assert.equal(competitorsByID.get("tekk-coach").sourceURL, "https://tekk.coach/");
    assert.equal(competitorsByID.get("tekk-coach").sourceDisplay, "tekk.coach");
    assert.equal(competitorsByID.get("pre-dev").sourceURL, "https://pre.dev/");
    assert.equal(competitorsByID.get("pre-dev").sourceDisplay, "pre.dev");
    assert.equal(competitorsByID.get("nanocorp").sourceURL, "");
    assert.equal(competitorsByID.get("nanocorp").sourceDisplay, "nanocorp fixture");
  });
});

test("strategy report normalizes provider searchableCopy strings instead of failing the report", async () => {
  await withTmpWorkspace(async (root) => {
    const providerSearchableCopy = "paid ask first_value evidence loop ".repeat(40);
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({
        text: JSON.stringify({ report: completeReport({ searchableCopy: providerSearchableCopy }) }),
        provider: "codex",
        researchSource: "Codex Exa MCP",
      }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({
        text: JSON.stringify({ report: completeReport({ searchableCopy: providerSearchableCopy }) }),
      }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "ready");
    assert.equal(Array.isArray(snapshot.report.searchableCopy), true);
    assert.equal(snapshot.report.searchableCopy.length, 1);
    assert.equal(snapshot.report.searchableCopy[0].length <= 500, true);
    assert.match(snapshot.report.searchableCopy[0], /paid ask first_value evidence loop/);
  });
});

test("strategy report ignores malformed optional layout helpers instead of failing the report", async () => {
  await withTmpWorkspace(async (root) => {
    const reportWithMalformedLayout = completeReport({
      swotMatrixColumnCount: "2",
      swotMatrixRows: [
        { left: "strengths", right: "weaknesses" },
        { left: "opportunities", right: "threats" },
      ],
      sourceRefs: { title: "Cursor", url: "https://cursor.com" },
      businessCanvasTopRows: [{ cells: ["partners"] }],
      businessCanvasBottomRow: { cells: ["cost-structure", "revenue-streams"] },
    });
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({
        text: JSON.stringify({ report: reportWithMalformedLayout }),
        provider: "codex",
        researchSource: "Codex Exa MCP",
      }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({
        text: JSON.stringify({ report: reportWithMalformedLayout }),
      }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "ready");
    assert.deepEqual(snapshot.report.swotMatrixRows, [["strengths", "weaknesses"], ["opportunities", "threats"]]);
    assert.deepEqual(snapshot.report.businessCanvasBottomRow, ["cost-structure", "revenue-streams"]);
  });
});

test("strategy report normalizes object-shaped display metadata instead of failing the report", async () => {
  await withTmpWorkspace(async (root) => {
    const objectMetaReport = completeReport({
      canvasMeta: { text: "9 blocks from object metadata" },
      matrixMeta: { label: "positioning from object metadata" },
      swotMeta: { note: "SWOT from object metadata" },
    });
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({
        text: JSON.stringify({ report: objectMetaReport }),
        provider: "codex",
        researchSource: "Codex Exa MCP",
      }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({
        text: JSON.stringify({ report: objectMetaReport }),
      }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "ready");
    assert.equal(snapshot.report.canvasMeta, "9 blocks from object metadata");
    assert.equal(snapshot.report.matrixMeta, "positioning from object metadata");
    assert.equal(snapshot.report.swotMeta, "SWOT from object metadata");
    assert.doesNotMatch(snapshot.report.canvasMeta, /\[object Object\]/);
    assert.doesNotMatch(snapshot.report.matrixMeta, /\[object Object\]/);
    assert.doesNotMatch(snapshot.report.swotMeta, /\[object Object\]/);
  });
});

test("strategy report canonicalizes provider canvas block aliases before required validation", async () => {
  await withTmpWorkspace(async (root) => {
    const aliasedBlocks = completeReport().canvasBlocks.map((block) => ({ ...block }));
    aliasedBlocks[3] = {
      id: "valueProposition",
      number: "02",
      eyebrow: "Value proposition",
      title: "가치 제안",
      tone: "accent",
      bullets: ["오늘 보낼 paid ask와 측정할 first_value를 좁힙니다."],
    };
    aliasedBlocks[6] = {
      id: "customer_segments",
      number: "01",
      label: "Customer segments",
      title: "고객 세그먼트",
      tone: "accent",
      items: ["전업 1인 개발자, 첫 매출 전, macOS 사용자"],
    };
    aliasedBlocks[7] = {
      id: "비용 구조",
      number: "09",
      label: "비용 구조",
      title: "비용 구조",
      tone: "magenta",
      bullets: ["provider execution 비용과 macOS 배포/지원 비용"],
    };
    aliasedBlocks[8] = {
      id: "pilotPayments",
      number: "05",
      title: "Pilot paid conversion",
      tone: "accent",
      bullets: ["pilot 유료 ask와 월 구독 전환"],
    };
    const aliasedReport = completeReport({ canvasBlocks: aliasedBlocks });

    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({
        text: JSON.stringify({ report: aliasedReport }),
        provider: "codex",
        researchSource: "Codex Exa MCP",
      }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({
        text: JSON.stringify({ report: aliasedReport }),
        provider: "codex",
        researchSource: "codex synthesis",
      }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "ready");
    const ids = snapshot.report.canvasBlocks.map((block) => block.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of REQUIRED_CANVAS_BLOCK_IDS) {
      assert.equal(ids.includes(id), true, `${id} should be present`);
    }
    assert.equal(snapshot.report.canvasBlocks.find((block) => block.title === "Pilot paid conversion").id, "revenue-streams");
  });
});

test("strategy report still fails after normalization when a required canvas block is genuinely absent", async () => {
  await withTmpWorkspace(async (root) => {
    const missingRevenueBlocks = completeReport().canvasBlocks.map((block) => (
      block.id === "revenue-streams"
        ? { ...block, id: "channels", number: "03", eyebrow: "Channels", title: "중복 채널" }
        : { ...block }
    ));
    const reportWithMissingBlock = completeReport({ canvasBlocks: missingRevenueBlocks });

    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({
        text: JSON.stringify({ report: reportWithMissingBlock }),
        provider: "codex",
        researchSource: "Codex Exa MCP",
      }),
      adversarialReviewer: async () => {
        throw new Error("should not run");
      },
      multidimensionalVerifier: async () => {
        throw new Error("should not run");
      },
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.report, null);
    assert.match(snapshot.status.error, /canvasBlocks/);
    assert.match(snapshot.status.error, /revenue-streams/);
  });
});

test("strategy report normalizes object-shaped adversarial review findings", async () => {
  await withTmpWorkspace(async (root) => {
    let observedReview = null;
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({
        text: JSON.stringify({ report: completeReport() }),
        provider: "codex",
        researchSource: "Codex Exa MCP",
      }),
      adversarialReviewer: async () => ({
        text: JSON.stringify({
          verdict: "pass_with_edits",
          confidence: 0.74,
          findings: [
            { title: "ICP risk", risk: "paid ask proof is still thin", recommendation: "narrow pilot segment" },
          ],
          required_changes: [
            { action: "tighten positioning", rationale: "avoid generic coding tool framing" },
          ],
        }),
      }),
      multidimensionalVerifier: async ({ adversarialReview }) => {
        observedReview = adversarialReview;
        return { text: JSON.stringify({ report: completeReport({ diagnosisKicker: "Verified diagnosis" }) }) };
      },
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "ready");
    assert.equal(observedReview.confidence, "0.74");
    assert.match(observedReview.findings[0], /ICP risk/);
    assert.match(observedReview.requiredChanges[0], /tighten positioning/);
  });
});

test("strategy report rejects missing summaryTiles before review passes", async () => {
  await withTmpWorkspace(async (root) => {
    const reportWithoutSummaryTiles = completeReport();
    delete reportWithoutSummaryTiles.summaryTiles;
    let adversarialCalled = false;
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({ text: JSON.stringify({ report: reportWithoutSummaryTiles }) }),
      adversarialReviewer: async () => {
        adversarialCalled = true;
        return { text: JSON.stringify({ verdict: "pass" }) };
      },
      multidimensionalVerifier: async () => {
        throw new Error("should not run");
      },
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(adversarialCalled, false);
    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.report, null);
    assert.match(snapshot.status.error, /missing required summaryTiles/);
  });
});

test("strategy report forwards provider progress text on the existing research stage", async () => {
  await withTmpWorkspace(async (root) => {
    const progressEvents = [];
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async ({ onProgress }) => {
        onProgress({
          stage: "running_provider_research",
          progressText: "Codex Exa MCP로 공개 근거를 검색하는 중",
          researchSource: "Codex Exa MCP",
        });
        return { text: JSON.stringify({ report: completeReport() }), provider: "codex", researchSource: "Codex Exa MCP" };
      },
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({ text: JSON.stringify({ report: completeReport() }) }),
      onProgress: (progress) => progressEvents.push(progress),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "ready");
    assert.equal(
      progressEvents.some((progress) => (
        progress.stage === "running_exa_research"
        && progress.progressText === "Codex Exa MCP로 공개 근거를 검색하는 중"
      )),
      true,
    );
  });
});

test("strategy report uses stale cache when a later refresh fails adversarial review", async () => {
  await withTmpWorkspace(async (root) => {
    const first = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({ text: JSON.stringify({ report: completeReport({ judgement: "이전 성공 판단" }) }) }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({ text: JSON.stringify({ report: completeReport({ judgement: "이전 성공 판단" }) }) }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    const second = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({ text: JSON.stringify({ report: completeReport({ judgement: "새 판단" }) }) }),
      adversarialReviewer: async () => {
        throw new Error("adversarial rejection");
      },
      multidimensionalVerifier: async () => {
        throw new Error("should not run");
      },
      now: new Date("2026-06-15T00:00:00.000Z"),
    });

    assert.equal(first.status.state, "ready");
    assert.equal(second.status.state, "failed");
    assert.equal(second.status.stale, true);
    assert.equal(second.report.judgement, "이전 성공 판단");
    assert.match(second.status.error, /adversarial rejection/);
  });
});

test("strategy report rejects provider output missing required static-equivalent sections", async () => {
  await withTmpWorkspace(async (root) => {
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({ text: JSON.stringify({ report: completeReport() }) }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({ text: JSON.stringify({ report: completeReport({ swotGroups: [] }) }) }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.report, null);
    assert.match(snapshot.status.error, /swotGroups/);
  });
});

test("strategy report normalizes oversized competitors before contract validation", async () => {
  await withTmpWorkspace(async (root) => {
    const oversizedCompetitors = [
      ...Array.from({ length: 13 }, (_, index) => competitorFixture(index + 1)),
      completeReport().competitors[0],
    ];
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({ text: JSON.stringify({ report: completeReport({ competitors: oversizedCompetitors }) }) }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({ text: JSON.stringify({ report: completeReport({ competitors: oversizedCompetitors }) }) }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "ready");
    assert.equal(snapshot.report.competitors.length, 12);
    assert.equal(snapshot.report.competitors.some((competitor) => competitor.id === "agentic30" && competitor.isAgentic30), true);
    assert.equal(snapshot.report.competitors.some((competitor) => competitor.id === "competitor-12"), false);

    const cache = JSON.parse(await fs.readFile(resolveStrategyReportCachePath(root), "utf8"));
    assert.equal(cache.rawProviderResult.passes[2].parsedReportShape.competitorCount, 14);
    assert.equal(cache.rawProviderResult.passes[2].parsedReportShape.competitorIds.includes("agentic30"), true);
  });
});

test("strategy report rejects output with fewer than three normalized competitors", async () => {
  await withTmpWorkspace(async (root) => {
    const competitors = [
      completeReport().competitors[0],
      competitorFixture(1),
    ];
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({ text: JSON.stringify({ report: completeReport() }) }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({ text: JSON.stringify({ report: completeReport({ competitors }) }) }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.report, null);
    assert.match(snapshot.status.error, /competitors/);
  });
});

test("strategy report rejects output missing the Agentic30 competitor", async () => {
  await withTmpWorkspace(async (root) => {
    const competitors = Array.from({ length: 3 }, (_, index) => competitorFixture(index + 1));
    const snapshot = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({ text: JSON.stringify({ report: completeReport() }) }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({ text: JSON.stringify({ report: completeReport({ competitors }) }) }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.report, null);
    assert.match(snapshot.status.error, /Agentic30 competitor/);
  });
});

test("strategy report failure diagnostics include competitor and section shape", async () => {
  await withTmpWorkspace(async (root) => {
    const oversizedCompetitors = [
      ...Array.from({ length: 13 }, (_, index) => competitorFixture(index + 1)),
      completeReport().competitors[0],
    ];
    const first = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({ text: JSON.stringify({ report: completeReport({ judgement: "이전 성공 판단" }) }) }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({ text: JSON.stringify({ report: completeReport({ judgement: "이전 성공 판단" }) }) }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });
    const second = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({ text: JSON.stringify({ report: completeReport({ competitors: oversizedCompetitors }) }) }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({
        text: JSON.stringify({ report: completeReport({ competitors: oversizedCompetitors, swotGroups: [] }) }),
      }),
      now: new Date("2026-06-15T00:00:00.000Z"),
    });

    assert.equal(first.status.state, "ready");
    assert.equal(second.status.state, "failed");
    assert.equal(second.status.stale, true);

    const cache = JSON.parse(await fs.readFile(resolveStrategyReportCachePath(root), "utf8"));
    const finalShape = cache.rawProviderResult.passes[2].parsedReportShape;
    assert.equal(finalShape.summaryTileCount, 3);
    assert.equal(finalShape.criteriaRowCount, 4);
    assert.equal(finalShape.canvasBlockCount, 9);
    assert.equal(finalShape.competitorCount, 14);
    assert.equal(finalShape.competitorIds.includes("agentic30"), true);
    assert.deepEqual(finalShape.swotGroupIds, []);
    assert.equal(finalShape.sourceRefCount, 1);
    assert.equal(cache.rawProviderResult.passes[2].structuredOutputRequested, true);
    assert.equal(cache.rawProviderResult.passes[2].structuredOutputSchemaName, STRATEGY_REPORT_OUTPUT_SCHEMA_NAME);
    assert.equal(cache.rawProviderResult.passes[2].structuredOutputFailure, "normalized_contract_violation");
  });
});

test("strategy report failure diagnostics keep pass summaries without raw provider text", async () => {
  await withTmpWorkspace(async (root) => {
    const first = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({
        text: JSON.stringify({ report: completeReport({ judgement: "이전 성공 판단" }) }),
        provider: "codex",
        researchSource: "Codex Exa MCP",
      }),
      adversarialReviewer: async () => ({
        text: JSON.stringify({ verdict: "pass" }),
        provider: "codex",
        researchSource: "codex synthesis",
      }),
      multidimensionalVerifier: async () => ({
        text: JSON.stringify({ report: completeReport({ judgement: "이전 성공 판단" }) }),
        provider: "codex",
        researchSource: "codex synthesis",
      }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    const second = await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({
        text: JSON.stringify({ report: completeReport({ judgement: "새 판단" }) }),
        provider: "codex",
        researchSource: "Codex Exa MCP",
      }),
      adversarialReviewer: async () => ({
        text: JSON.stringify({ verdict: "pass" }),
        provider: "codex",
        researchSource: "codex synthesis",
      }),
      multidimensionalVerifier: async () => ({
        text: JSON.stringify({ report: completeReport({ judgement: "새 판단", swotGroups: [] }) }),
        provider: "codex",
        researchSource: "codex synthesis",
      }),
      now: new Date("2026-06-15T00:00:00.000Z"),
    });

    assert.equal(first.status.state, "ready");
    assert.equal(second.status.state, "failed");
    assert.equal(second.status.stale, true);
    assert.equal(second.report.judgement, "이전 성공 판단");
    assert.match(second.status.error, /swotGroups/);

    const cache = JSON.parse(await fs.readFile(resolveStrategyReportCachePath(root), "utf8"));
    assert.equal(cache.rawProviderResult.mode, "three_pass_strategy_report_failed");
    assert.match(cache.rawProviderResult.error, /swotGroups/);
    assert.equal(cache.rawProviderResult.passes.length, 3);
    assert.equal(cache.rawProviderResult.passes[0].mode, "exa_research");
    assert.equal(cache.rawProviderResult.passes[1].mode, "adversarial_review");
    assert.equal(cache.rawProviderResult.passes[2].mode, "multidimensional_verification");
    assert.equal(cache.rawProviderResult.passes.every((pass) => pass.textChars > 0), true);
    assert.equal(cache.rawProviderResult.passes.every((pass) => !Object.hasOwn(pass, "text")), true);
    assert.equal(cache.rawProviderResult.passes[0].parsedReportShape.canvasBlockCount, 9);
    assert.equal(cache.rawProviderResult.passes[2].parsedReportShape.canvasBlockCount, 9);
    assert.equal(cache.rawProviderResult.passes[2].parsedReportShape.canvasBlocks.length, 9);
    assert.equal(
      cache.rawProviderResult.passes[2].parsedReportShape.canvasBlocks.some((block) => (
        block.id === "revenue-streams"
        && block.number === "05"
        && block.title === "수익원"
        && block.canonicalId === "revenue-streams"
      )),
      true,
    );

    const runFiles = (await fs.readdir(resolveStrategyReportRunsDir(root)))
      .filter((file) => file.endsWith(".json"))
      .sort();
    const latestRun = JSON.parse(
      await fs.readFile(path.join(resolveStrategyReportRunsDir(root), runFiles.at(-1)), "utf8"),
    );
    assert.equal(latestRun.rawProviderResult.mode, "three_pass_strategy_report_failed");
    assert.match(latestRun.rawProviderResult.error, /swotGroups/);
    assert.equal(latestRun.rawProviderResult.passes.every((pass) => !Object.hasOwn(pass, "text")), true);
    assert.equal(latestRun.rawProviderResult.passes[2].parsedReportShape.canvasBlockCount, 9);
    assert.equal(latestRun.rawProviderResult.passes[2].parsedReportShape.canvasBlocks[0].canonicalId, "partners");
  });
});

test("strategy report redacts private and secret-like text before cache persistence", async () => {
  await withTmpWorkspace(async (root) => {
    const privateText = "interview transcript says email founder@example.com token sk-secret123456789";
    await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({ text: JSON.stringify({ report: completeReport({ diagnosisLead: privateText }) }) }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass", findings: [privateText] }) }),
      multidimensionalVerifier: async () => ({ text: JSON.stringify({ report: completeReport({ diagnosisLead: privateText }) }) }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    const cacheText = await fs.readFile(resolveStrategyReportCachePath(root), "utf8");
    assert.doesNotMatch(cacheText, /founder@example\.com/);
    assert.doesNotMatch(cacheText, /sk-secret123456789/);
    assert.doesNotMatch(cacheText, /interview transcript/i);
    assert.match(cacheText, /\[redacted-private\]/);
  });
});

test("strategy report cache has 0600 permissions and can load stale fallback", async () => {
  await withTmpWorkspace(async (root) => {
    await refreshStrategyReport({
      workspaceRoot: root,
      exaResearchRoutes: [exaRoute()],
      force: true,
      providerResearcher: async () => ({ text: JSON.stringify({ report: completeReport({ generatedBadge: "검증 완료" }) }) }),
      adversarialReviewer: async () => ({ text: JSON.stringify({ verdict: "pass" }) }),
      multidimensionalVerifier: async () => ({ text: JSON.stringify({ report: completeReport({ generatedBadge: "검증 완료" }) }) }),
      now: new Date("2026-06-14T00:00:00.000Z"),
    });

    const cachePath = resolveStrategyReportCachePath(root);
    const stat = await fs.stat(cachePath);
    assert.equal(stat.mode & 0o777, 0o600);

    const loaded = await loadStrategyReportSnapshot({
      workspaceRoot: root,
      exaConfigured: false,
      now: new Date("2026-06-16T00:00:00.000Z"),
    });
    assert.equal(loaded.status.state, "stale");
    assert.equal(loaded.status.reason, "exa_mcp_missing");
    assert.equal(loaded.report.generatedBadge, "검증 완료");
  });
});

test("strategy report progress status mirrors refreshing stage metadata", () => {
  const status = buildStrategyReportProgressStatus(
    { stage: "running_adversarial_review" },
    { reason: "manual", startedAt: Date.parse("2026-06-14T00:00:00.000Z"), nowMs: Date.parse("2026-06-14T00:00:01.500Z") },
  );
  assert.equal(status.state, "refreshing");
  assert.equal(status.stage, "running_adversarial_review");
  assert.equal(status.stepIndex, 4);
  assert.equal(status.stepCount, STRATEGY_REPORT_PROGRESS_STEPS.length);
  assert.equal(status.elapsedMs, 1500);
});

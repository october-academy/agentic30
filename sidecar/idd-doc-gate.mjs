import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isBipCoachConfigured } from "./bip-coach-state.mjs";
import { normalizeWorkspaceOnboardingHypothesis } from "./onboarding-hypothesis.mjs";
import { CODEX_STRUCTURED_INPUT_TOOL } from "./structured-input-tools.mjs";
import {
  FOUNDATION_PROJECT_DOC_TYPES,
  projectDocDefinitions,
  projectDocPath,
} from "./project-doc-paths.mjs";
import {
  buildOfficeHoursEvidenceState,
  evidenceSidecarPath,
  mergeDay1HandoffWithEvidence,
  renderOfficeHoursEvidenceDebtCard,
  writeOfficeHoursEvidenceDebtReport,
  writeOfficeHoursEvidenceSidecar,
} from "./office-hours-evidence-state.mjs";
import {
  OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE,
  judgeOfficeHoursEvidenceDocuments,
} from "./office-hours-evidence-judge.mjs";

export const IDD_SETUP_SCHEMA_VERSION = 2;

export const DAY1_HANDOFF_DOC_TYPES = ["goal", "icp", "values", "spec"];

export const DAY1_HANDOFF_MARKER_START = "<!-- agentic30:day1-handoff:start -->";
export const DAY1_HANDOFF_MARKER_END = "<!-- agentic30:day1-handoff:end -->";

export const IDD_FOUNDATION_DOCS = projectDocDefinitions(FOUNDATION_PROJECT_DOC_TYPES);

export const IDD_FOUNDATION_DOC_TYPES = IDD_FOUNDATION_DOCS.map((doc) => doc.type);

export const IDD_AMBIGUITY_THRESHOLD = 20;

const IDD_RUBRIC_SIGNALS = {
  icp: [
    { id: "narrow_segment", label: "고객 후보가 좁은 고객군으로 표현되어야 합니다.", dimension: "specificity" },
    { id: "reachable_person", label: "이번 주 연락 가능한 실제 사람/계정이 필요합니다.", dimension: "evidence" },
    { id: "current_alternative", label: "현재 대안이나 우회 행동이 필요합니다.", dimension: "evidence" },
    { id: "pressure_cost", label: "시간, 돈, 평판 중 어떤 압박이 있는지 필요합니다.", dimension: "evidence" },
  ],
  goal: [
    { id: "proof_target", label: "이번 주 검증 기준이 필요합니다.", dimension: "scope" },
    { id: "metric", label: "진척을 판단할 측정 지표가 필요합니다.", dimension: "evidence" },
    { id: "threshold", label: "기준값, 목표값, 기한 중 하나가 필요합니다.", dimension: "specificity" },
    { id: "failure_condition", label: "실패 판정 조건이 필요합니다.", dimension: "risk" },
  ],
  values: [
    { id: "tradeoff", label: "가치가 바꾸는 실제 우선순위 선택이 필요합니다.", dimension: "risk" },
    { id: "rejected_option", label: "이 원칙 때문에 포기할 선택지가 필요합니다.", dimension: "scope" },
    { id: "trigger", label: "언제 이 원칙을 적용하는지 필요합니다.", dimension: "specificity" },
    { id: "violation_example", label: "위반 예시나 금지 행동이 필요합니다.", dimension: "risk" },
  ],
  spec: [
    { id: "user_workflow", label: "한 사용자의 실제 작업 흐름이 필요합니다.", dimension: "specificity" },
    { id: "mvp_wedge", label: "이번 주 만들 가장 작은 첫 버전 범위가 필요합니다.", dimension: "scope" },
    { id: "non_goal", label: "첫 버전에서 하지 않을 일이 필요합니다.", dimension: "scope" },
    { id: "observable_success", label: "관찰 가능한 성공 기준이 필요합니다.", dimension: "evidence" },
    { id: "core_risk", label: "틀리면 무너지는 핵심 리스크가 필요합니다.", dimension: "risk" },
  ],
};

const IDD_DIMENSIONS = [
  { id: "specificity", label: "구체성" },
  { id: "evidence", label: "증거" },
  { id: "scope", label: "범위" },
  { id: "risk", label: "리스크" },
];

export const BIP_REQUIRED_LOCAL_DOCS = projectDocDefinitions([
  "icp",
  "spec",
  "values",
  "designSystem",
  "adr",
  "goal",
  "docs",
  "sheet",
]);

export function iddArtifactsDir(workspaceRoot) {
  return path.join(path.resolve(workspaceRoot || "."), ".agentic30", "idd");
}

export function iddSetupStatePath(workspaceRoot) {
  return path.join(iddArtifactsDir(workspaceRoot), "setup-state.json");
}

export function emptyIddSetupState() {
  return {
    schemaVersion: IDD_SETUP_SCHEMA_VERSION,
    status: "not_started",
    currentDocType: IDD_FOUNDATION_DOCS[0].type,
    docOrder: IDD_FOUNDATION_DOC_TYPES,
    transcript: [],
    ambiguityScore: 100,
    ambiguityRubric: emptyIddAmbiguityRubric(),
    unresolvedAssumptions: [
      "첫 고객 정의가 아직 문서로 승인되지 않았습니다.",
      "이번 주 목표와 하지 않을 일이 아직 고정되지 않았습니다.",
      "제품 범위와 성공 기준이 아직 승인되지 않았습니다.",
    ],
    drafts: {},
    docWriteStatuses: {},
    approvedAt: null,
    approvedDocPaths: [],
    lastProvider: null,
    providerRecovery: null,
    setupError: null,
    updatedAt: null,
  };
}

function normalizeDocWriteStatuses(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out = {};
  for (const doc of IDD_FOUNDATION_DOCS) {
    const raw = value[doc.type];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const status = String(raw.status || "").trim();
    if (!status) continue;
    out[doc.type] = {
      type: doc.type,
      path: String(raw.path || doc.canonicalPath),
      status,
      writtenAt: typeof raw.writtenAt === "string" ? raw.writtenAt : null,
      unresolvedAssumptions: Array.isArray(raw.unresolvedAssumptions)
        ? raw.unresolvedAssumptions.map(String).filter(Boolean)
        : [],
      ...(typeof raw.evidencePath === "string" && raw.evidencePath ? { evidencePath: raw.evidencePath } : {}),
      ...(Number.isFinite(Number(raw.judgeScore)) ? { judgeScore: Number(raw.judgeScore) } : {}),
      ...(typeof raw.judgeStatus === "string" && raw.judgeStatus ? { judgeStatus: raw.judgeStatus } : {}),
    };
  }
  return out;
}

export function normalizeIddSetupState(value = {}) {
  const base = emptyIddSetupState();
  const transcript = Array.isArray(value.transcript) ? value.transcript : [];
  const drafts = value.drafts && typeof value.drafts === "object" && !Array.isArray(value.drafts)
    ? value.drafts
    : {};
  const approved = value.status === "approved" || Boolean(value.approvedAt);
  const docWriteStatuses = normalizeDocWriteStatuses(value.docWriteStatuses);
  const allDay1HandoffDocsWritten = DAY1_HANDOFF_DOC_TYPES.every((type) =>
    ["written", "written_with_assumptions", "approved"].includes(docWriteStatuses[type]?.status),
  );
  const answeredCount = IDD_FOUNDATION_DOC_TYPES.filter((type) => typeof drafts[type] === "string" && drafts[type].trim()).length;
  const previewReady = answeredCount >= IDD_FOUNDATION_DOCS.length;
  const rubric = calculateIddAmbiguityRubric({ ...value, transcript, drafts });
  const rubricPreviewReady = previewReady && !rubric.blocked;
  const currentDocType = IDD_FOUNDATION_DOC_TYPES.includes(value.currentDocType)
    ? value.currentDocType
    : IDD_FOUNDATION_DOCS[Math.min(answeredCount, IDD_FOUNDATION_DOCS.length - 1)].type;
  return {
    ...base,
    ...value,
    schemaVersion: IDD_SETUP_SCHEMA_VERSION,
    status: (approved || allDay1HandoffDocsWritten) ? "approved" : (rubricPreviewReady ? "preview_ready" : (value.status === "provider_recovery" || value.status === "error" ? value.status : (answeredCount > 0 ? "interviewing" : value.status || "not_started"))),
    currentDocType,
    docOrder: IDD_FOUNDATION_DOC_TYPES,
    transcript,
    ambiguityScore: rubric.score,
    ambiguityRubric: rubric,
    unresolvedAssumptions: approved && Array.isArray(value.unresolvedAssumptions)
      ? value.unresolvedAssumptions.map(String).filter(Boolean)
      : (rubric.unresolvedAssumptions.length ? rubric.unresolvedAssumptions : base.unresolvedAssumptions),
    drafts,
    docWriteStatuses,
    approvedAt: typeof value.approvedAt === "string" ? value.approvedAt : (allDay1HandoffDocsWritten ? new Date().toISOString() : null),
    approvedDocPaths: Array.isArray(value.approvedDocPaths) && value.approvedDocPaths.length
      ? value.approvedDocPaths.map(String)
      : (allDay1HandoffDocsWritten
          ? DAY1_HANDOFF_DOC_TYPES.map((type) => requiredDocByType(type)?.canonicalPath).filter(Boolean)
          : []),
    lastProvider: typeof value.lastProvider === "string" ? value.lastProvider : null,
    providerRecovery: value.providerRecovery && typeof value.providerRecovery === "object" ? value.providerRecovery : null,
    setupError: value.setupError && typeof value.setupError === "object" ? {
      message: String(value.setupError.message || "초기 설정 질문 카드 준비가 중단됐습니다."),
      provider: typeof value.setupError.provider === "string" ? value.setupError.provider : null,
      docType: IDD_FOUNDATION_DOC_TYPES.includes(value.setupError.docType) ? value.setupError.docType : null,
      recoverable: value.setupError.recoverable !== false,
    } : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

export async function loadIddSetupState(workspaceRoot, { fsImpl = fs } = {}) {
  try {
    const raw = await fsImpl.readFile(iddSetupStatePath(workspaceRoot), "utf8");
    return normalizeIddSetupState(JSON.parse(raw));
  } catch {
    return emptyIddSetupState();
  }
}

export async function persistIddSetupState(workspaceRoot, state, { fsImpl = fs } = {}) {
  const next = normalizeIddSetupState({
    ...state,
    updatedAt: new Date().toISOString(),
  });
  await fsImpl.mkdir(iddArtifactsDir(workspaceRoot), { recursive: true });
  await fsImpl.writeFile(iddSetupStatePath(workspaceRoot), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fsImpl.writeFile(
    path.join(iddArtifactsDir(workspaceRoot), "transcript.json"),
    `${JSON.stringify(next.transcript, null, 2)}\n`,
    "utf8",
  );
  await fsImpl.writeFile(
    path.join(iddArtifactsDir(workspaceRoot), "assumptions.json"),
    `${JSON.stringify({
      ambiguityScore: next.ambiguityScore,
      ambiguityRubric: next.ambiguityRubric,
      unresolvedAssumptions: next.unresolvedAssumptions,
      updatedAt: next.updatedAt,
    }, null, 2)}\n`,
    "utf8",
  );
  return next;
}

export function nextIddFoundationDoc(state) {
  const normalized = normalizeIddSetupState(state);
  const answered = new Set(Object.entries(normalized.drafts)
    .filter(([, draft]) => typeof draft === "string" && draft.trim())
    .map(([type]) => type));
  return IDD_FOUNDATION_DOCS.find((doc) => !answered.has(doc.type)) || null;
}

export function isIddSetupApproved(state) {
  return normalizeIddSetupState(state).status === "approved";
}

export const ICP_CONTEXT_INTRO = {
  // This is the teaching panel whose linked resources are English
  // "Ideal Customer Profile" articles, and isMissingIcpContextIntro() uses the
  // full term as the signature of a properly-decorated card.
  title: "Ideal Customer Profile",
  body: "가장 먼저 집중할 고객 유형입니다. 처음부터 완벽하게 쓰기보다, 이번 주 실제로 연락하고 인터뷰할 수 있는 좁은 고객 후보 하나를 고르면 됩니다.",
  bullets: [
    "상황: 직함보다 지금 어떤 문제 상황에 있는지",
    "트리거: 언제 그 문제가 더 급해지는지",
    "현재 대안: 지금 어떤 수작업이나 도구로 버티는지",
    "검증: 이번 주 연락 가능한 실제 사람인지",
  ],
};

export const ICP_RECOMMENDED_RESOURCES = [
  {
    title: "Creating an Ideal Customer Profile transformed our company",
    source: "PostHog",
    url: "https://posthog.com/newsletter/ideal-customer-profile-framework",
    description: "고객 후보와 대표 고객상의 차이, 좁은 고객 후보가 전략에 주는 영향을 설명합니다.",
  },
  {
    title: "How we found our Ideal Customer Profile",
    source: "PostHog",
    url: "https://posthog.com/founders/creating-ideal-customer-profile",
    description: "PostHog가 필요, 현재 행동, 먼저 물어볼 사람을 기준으로 고객 후보를 좁힌 과정입니다.",
  },
  {
    title: "Defining our ICP is the most important thing we ever did",
    source: "Product for Engineers",
    url: "https://newsletter.posthog.com/p/defining-our-icp-is-the-most-important",
    description: "고객 후보를 빨리 세우고 테스트해야 하는 이유를 다룹니다.",
  },
];

export function decorateIcpStructuredInput(input) {
  if (!input || typeof input !== "object") return input;
  return {
    ...input,
    intro: input.intro || ICP_CONTEXT_INTRO,
    resources: Array.isArray(input.resources) && input.resources.length > 0
      ? input.resources
      : ICP_RECOMMENDED_RESOURCES,
  };
}

export const ICP_IDD_INITIAL_INPUT = {
  toolName: CODEX_STRUCTURED_INPUT_TOOL,
  title: "Ideal Customer Profile 1/4",
  intro: ICP_CONTEXT_INTRO,
  resources: ICP_RECOMMENDED_RESOURCES,
  questions: [
    {
      header: "첫 고객",
      helperText: "먼저 실제로 연락 가능한 고객 유형 하나만 고릅니다. 자세한 기준은 다음 단계에서 정리합니다.",
      question: "이번 주 가장 먼저 인터뷰할 고객 유형은 누구인가요?",
      options: [
        {
          label: "가장 절박한 사람",
          description: "이번 주 돈, 시간, 평판 중 하나가 이미 압박합니다.",
          nextIntent: "urgent_icp",
        },
        {
          label: "이미 우회 중인 사람",
          description: "수작업이나 다른 툴로 이미 시간을 쓰고 있습니다.",
          nextIntent: "existing_alternative",
        },
        {
          label: "이미 돈/시간 쓰는 사람",
          description: "예산이나 일정이 걸려 있어 신호가 강합니다.",
          nextIntent: "budget_or_time_committed",
        },
      ],
      multiSelect: false,
      allowFreeText: true,
      requiresFreeText: false,
      freeTextPlaceholder: "예: 퇴사 후 아직 첫 매출이 없는 1인 개발자",
      textMode: "short",
    },
  ],
};

// These fingerprints match the *historical* static IDD output that older
// builds persisted/cached. They must stay verbatim to the legacy copy so a
// stale cached card is still detected and regenerated — do NOT jargon-rewrite
// them (the live builder no longer emits this text at all).
const LEGACY_STATIC_IDD_FINGERPRINTS = [
  "가장 절박한 하위 ICP",
];

export function isLegacyStaticIddUserInputRequest(request) {
  const haystack = [
    request?.title,
    ...(Array.isArray(request?.questions)
      ? request.questions.flatMap((question) => [
          question?.header,
          question?.question,
          question?.helperText,
          question?.freeTextPlaceholder,
          ...(Array.isArray(question?.options)
            ? question.options.flatMap((option) => [
                option?.label,
                option?.description,
                option?.preview,
                option?.nextIntent,
              ])
            : []),
        ])
      : []),
  ]
    .filter(Boolean)
    .join("\n");

  return LEGACY_STATIC_IDD_FINGERPRINTS.some((fingerprint) =>
    haystack.includes(fingerprint),
  );
}

export function isStaleGenericHostIddUserInputRequest(request) {
  if (request?.generation?.mode !== "host_structured" || request?.generation?.docType !== "icp") {
    return false;
  }
  const questions = Array.isArray(request?.questions) ? request.questions : [];
  const primaryQuestion = String(questions[0]?.question || "").trim();
  const staleQuestion = primaryQuestion === "이번 주 바로 인터뷰할 첫 고객은 누구인가요?"
    || primaryQuestion.includes("이번 주 바로 인터뷰할 첫 고객")
    || primaryQuestion.includes("이번 주 먼저 만날 사람");
  if (!staleQuestion) {
    return false;
  }
  const optionLabels = questions.flatMap((question) =>
    Array.isArray(question?.options) ? question.options.map((option) => String(option?.label || "")) : []
  );
  return optionLabels.some((label) =>
    [
      "퇴사 후 수익 0원 1인 개발자",
      "에이전트로 첫 버전을 만든 개발자",
      "인터뷰/공개 기록 의향 있음",
    ].includes(label)
  );
}

export function isStaleAwkwardIcpUserInputRequest(request) {
  if (request?.generation?.docType !== "icp") {
    return false;
  }
  if (!["host_structured", "sidecar_agent_synthesized"].includes(request?.generation?.mode)) {
    return false;
  }
  const haystack = [
    request?.title,
    ...(Array.isArray(request?.questions)
      ? request.questions.flatMap((question) => [
          question?.question,
          question?.helperText,
          question?.freeTextPlaceholder,
          ...(Array.isArray(question?.options)
            ? question.options.flatMap((option) => [option?.label, option?.description])
            : []),
        ])
      : []),
  ].filter(Boolean).join("\n");
  return /세그먼트부터 시작|N번째 제품 실패한|N번째 MVP 실패|macOS 개발자/.test(haystack);
}

export function isMissingIcpContextIntro(request) {
  if (request?.generation?.docType !== "icp") {
    return false;
  }
  if (!["host_structured", "sidecar_agent_synthesized", "provider_adaptive"].includes(request?.generation?.mode)) {
    return false;
  }
  const introTitle = String(request?.intro?.title || "");
  const introBody = String(request?.intro?.body || "");
  const resourceUrls = Array.isArray(request?.resources)
    ? request.resources.map((resource) => String(resource?.url || ""))
    : [];
  return !introTitle.includes("Ideal Customer Profile")
    || !introBody.includes("이번 주 실제로 연락")
    || !ICP_RECOMMENDED_RESOURCES.every((resource) => resourceUrls.includes(resource.url));
}

export function initialIddStructuredInputForDoc(
  doc,
  {
    provider = "codex",
    onboardingHypothesis = null,
    onboardingContext = null,
    forceHostStructuredInput = false,
  } = {},
) {
  // Host-owned IDD question builder. Runtime first-question generation uses this
  // path so Foundation Setup is not coupled to provider MCP approval state.
  if ((!forceHostStructuredInput && provider !== "codex") || !doc?.type) return null;
  if (doc.type === "icp") {
    return decorateIcpStructuredInput(buildAdaptiveIcpInitialInput({ onboardingHypothesis, onboardingContext }));
  }
  if (doc.type === "goal") {
    return buildGoalIddInitialInput(doc);
  }
  if (doc.type === "values") {
    return buildValuesIddInitialInput(doc);
  }
  if (doc.type === "spec") {
    return buildSpecIddInitialInput(doc);
  }
  return buildGenericIddInitialInput(doc);
}

export function buildAdaptiveIcpInitialInput({
  onboardingHypothesis = null,
  onboardingContext = null,
} = {}) {
  const hypothesis = normalizeWorkspaceOnboardingHypothesis(onboardingHypothesis);
  const primaryUser = hypothesis.likelyUsers?.[0] || "";
  const projectKind = projectKindLabel(hypothesis.projectKind);
  const helperText = buildAdaptiveHelperText(hypothesis);
  const question = buildAdaptiveQuestion(hypothesis, primaryUser, projectKind);
  const personalizedOptions = buildAdaptiveOptions({ hypothesis, primaryUser, onboardingContext });
  return {
    toolName: CODEX_STRUCTURED_INPUT_TOOL,
    title: "Ideal Customer Profile 1/4",
    questions: [
      {
        header: "첫 고객",
        helperText,
        question,
        options: personalizedOptions,
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        freeTextPlaceholder: freeTextPlaceholderFor(primaryUser, hypothesis),
        textMode: "short",
      },
    ],
  };
}

export function buildGenericIddInitialInput(doc) {
  const canonicalPath = String(doc?.canonicalPath || projectDocPath("docs")).trim();
  const title = genericIddUserFacingTitle(doc);
  const focus = genericIddUserFacingFocus(doc);
  const purpose = genericIddPurposeFor(doc, canonicalPath, focus);
  const risk = genericIddRiskFor(doc, canonicalPath);
  const options = genericIddInitialOptionsFor(doc, { focus });
  return {
    toolName: CODEX_STRUCTURED_INPUT_TOOL,
    title: `${title} 정하기`,
    questions: [
      {
        header: "한 가지 선택",
        helperText: `목적: ${shortenSentence(purpose, 70)} 저장: ${canonicalPath}`,
        question: `${title}에서 이번 주 먼저 고정할 기준은 무엇인가요?`,
        options,
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        freeTextPlaceholder: "예: 이번 주 결정에 꼭 필요한 기준 1개",
        textMode: "short",
      },
    ],
  };
}

function buildGoalIddInitialInput(doc) {
  const canonicalPath = String(doc?.canonicalPath || projectDocPath("goal")).trim();
  return {
    toolName: CODEX_STRUCTURED_INPUT_TOOL,
    title: "목표 정하기",
    questions: [
      {
        header: "이번 주 목표",
        helperText: `먼저 검증할 목표를 정합니다. 검증 기준, 지표, 실패 조건은 다음 카드에서 좁힙니다. 저장: ${canonicalPath}`,
        question: "이번 주에 가장 먼저 검증하거나 달성하려는 목표는 무엇인가요?",
        options: [
          {
            label: "첫 고객 반응 확인",
            description: "고객 후보가 이 문제에 답변, 미팅, 사용 시도 같은 실제 반응을 보이는지 봅니다.",
            nextIntent: "goal_customer_response",
          },
          {
            label: "문제 강도 확인",
            description: "고객 후보가 현재 대안의 시간, 돈, 평판 비용을 실제로 겪는지 봅니다.",
            nextIntent: "goal_problem_intensity",
          },
          {
            label: "가장 작은 해결책 확인",
            description: "이번 주 만들 수 있는 작은 첫 버전이 한 사용자에게 충분히 유용한지 봅니다.",
            nextIntent: "goal_smallest_solution",
          },
        ],
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        freeTextPlaceholder: "예: 이번 주 5명에게 인터뷰 요청하고 3명 이상 답하면 첫 고객 반응 GOAL을 통과로 본다",
        textMode: "short",
      },
    ],
  };
}

function buildValuesIddInitialInput(doc) {
  const canonicalPath = String(doc?.canonicalPath || projectDocPath("values")).trim();
  return {
    toolName: CODEX_STRUCTURED_INPUT_TOOL,
    title: "원칙 정하기",
    questions: [
      {
        header: "결정 원칙",
        helperText: `이번 주 의사결정에서 무엇을 포기할지 먼저 정합니다. 저장: ${canonicalPath}`,
        question: "이번 주 어떤 상황에서 반드시 지킬 우선순위 선택이나 거절 기준은 무엇인가요?",
        options: [
          {
            label: "속도보다 증거",
            description: "멋진 기능보다 실제 사용자 반응이나 과거 행동 증거를 우선합니다.",
            nextIntent: "values_evidence_over_speed",
          },
          {
            label: "자동화보다 직접 관찰",
            description: "처음에는 에이전트 자동화보다 사용자가 막히는 장면을 직접 봅니다.",
            nextIntent: "values_observation_over_automation",
          },
          {
            label: "넓은 기능보다 좁은 성공",
            description: "많은 Day/기능보다 한 사용자가 끝까지 완료하는 흐름을 우선합니다.",
            nextIntent: "values_narrow_success",
          },
        ],
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        freeTextPlaceholder: "예: 첫 실행에서는 멋진 채팅보다 질문이 바뀌지 않는 신뢰를 우선한다",
        textMode: "short",
      },
    ],
  };
}

function buildSpecIddInitialInput(doc) {
  const canonicalPath = String(doc?.canonicalPath || projectDocPath("spec")).trim();
  return {
    toolName: CODEX_STRUCTURED_INPUT_TOOL,
    title: "첫 버전 정하기",
    questions: [
      {
        header: "첫 버전 흐름",
        helperText: `한 사용자가 끝내야 할 작업 흐름과 첫 버전 범위를 고정합니다. 저장: ${canonicalPath}`,
        question: "이번 주 첫 버전에서 사용자가 반드시 끝내야 하는 핵심 작업 흐름은 무엇인가요?",
        options: [
          {
            label: "첫 질문에 답하기",
            description: "기초 질문이 안정적으로 나타나고 사용자가 답변을 제출합니다.",
            nextIntent: "spec_first_question_flow",
          },
          {
            label: "4문서 승인하기",
            description: "고객 후보, 목표, 원칙, 첫 버전 초안을 검토하고 Day 1 미션을 엽니다.",
            nextIntent: "spec_approve_foundation_docs",
          },
          {
            label: "첫 미션 저장하기",
            description: "문서 승인 뒤 Day 1 미션을 선택하거나 생성해 실행 상태로 둡니다.",
            nextIntent: "spec_save_first_mission",
          },
        ],
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        freeTextPlaceholder: "예: 사용자가 첫 질문에 답하고 4문서 미리보기를 승인하면 Day 1 미션이 열린다",
        textMode: "short",
      },
    ],
  };
}

export function buildIddFollowupStructuredInputForDoc(doc, state = {}) {
  const normalized = normalizeIddSetupState(state);
  const docResult = normalized.ambiguityRubric.docs.find((entry) => entry.type === doc?.type);
  const missingSignal = docResult?.missingSignals?.[0];
  const signalId = missingSignal?.id || "missing_signal";
  const signalLabel = missingSignal?.label || "문서를 구체적으로 쓰기 위한 근거가 더 필요합니다.";
  const copy = followupCopyForSignal(doc, signalId, signalLabel, normalized);
  const docTranscript = Array.isArray(normalized.transcript)
    ? normalized.transcript.filter((entry) => entry?.docType === doc?.type)
    : [];
  const previousEntry = docTranscript.length ? docTranscript[docTranscript.length - 1] : null;
  const previousSignalId = previousEntry?.signalId ? String(previousEntry.signalId) : null;
  const previousSignalLabel = previousEntry?.signalLabel ? String(previousEntry.signalLabel) : null;
  const dimensionTransitioned = Boolean(previousSignalId && previousSignalId !== signalId);
  const isLastSignalForDoc = (docResult?.missingSignals?.length || 0) === 1;

  // PR1: surface dimension progress so the Mac UI can render a 4-dot
  // breadcrumb and a "previously chose X" chip. Without these the user
  // sees "1/4" three times in a row even though the rubric is genuinely
  // walking narrow_segment → reachable_person → current_alternative →
  // pressure_cost behind the scenes.
  const docSignalsAll = Array.isArray(IDD_RUBRIC_SIGNALS[doc?.type])
    ? IDD_RUBRIC_SIGNALS[doc.type]
    : [];
  const dimensionTotal = docSignalsAll.length || null;
  const currentSignalIdx = dimensionTotal
    ? docSignalsAll.findIndex((entry) => entry.id === signalId)
    : -1;
  const dimensionStepIndex = currentSignalIdx >= 0 ? currentSignalIdx + 1 : null;
  const previousAnswerText = String(previousEntry?.responseText || "").trim();
  const previousAnswerLabel = dimensionTransitioned && previousAnswerText
    ? (previousAnswerText.length > 22
        ? `${previousAnswerText.slice(0, 22).trim()}…`
        : previousAnswerText)
    : null;

  const ambiguityLine = `Ambiguity ${normalized.ambiguityScore}% · 목표 ${IDD_AMBIGUITY_THRESHOLD}% 이하`;
  const transitionPrev = previousAnswerLabel || previousSignalLabel;
  const transitionLine = dimensionTransitioned && transitionPrev
    ? `방금 ‘${transitionPrev}’ 선택 완료. 이제 ${copy.header} 단계입니다.`
    : null;
  const helperText = transitionLine ? `${transitionLine}\n${ambiguityLine}` : ambiguityLine;

  return {
    toolName: CODEX_STRUCTURED_INPUT_TOOL,
    title: `${doc.title} · ${copy.header}`,
    generation: {
      mode: "host_structured",
      docType: doc?.type || "",
      signalId,
      signalLabel: copy.header,
      isLastSignalForDoc,
      dimensionTransitioned,
      previousSignalLabel: dimensionTransitioned ? previousSignalLabel : null,
      previousAnswerLabel,
      dimensionStepIndex,
      dimensionTotal,
    },
    questions: [
      {
        header: copy.header,
        helperText,
        question: copy.question,
        options: copy.options,
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        freeTextPlaceholder: copy.placeholder,
        textMode: copy.textMode || "short",
      },
    ],
  };
}

function followupCopyForSignal(doc, signalId, signalLabel, state = null) {
  const fallback = {
    header: "근거 보완",
    question: `${doc?.title || "문서"}를 쓸 수 있게 이 빠진 근거를 한 줄로 보완해주세요: ${signalLabel}`,
    placeholder: "예: 이번 주 확인 가능한 사람/행동/숫자/실패 조건",
    options: [
      { label: "실제 사람/상황으로 보완", description: "누가 어떤 상황에서 겪는지 좁힙니다.", nextIntent: signalId },
      { label: "숫자/기준으로 보완", description: "시간, 금액, 횟수, 기한, 목표값 중 하나를 넣습니다.", nextIntent: signalId },
      { label: "리스크/실패 조건으로 보완", description: "틀렸을 때 무엇을 실패로 볼지 적습니다.", nextIntent: signalId },
    ],
  };
  if (doc?.type === "values") {
    const valuesCopy = valuesFollowupCopyForSignal(signalId, state);
    if (valuesCopy) return valuesCopy;
  }

  const bySignal = {
    narrow_segment: {
      header: "좁히기",
      question: "이 고객 후보를 바로 문서에 쓸 수 있게 가장 좁은 고객군으로 다시 말하면 누구인가요?",
      placeholder: "예: 유료 고객 0명이고 macOS에서 Codex를 쓰는 전업 1인 개발자",
      options: [
        { label: "상황으로 좁히기", description: "직업보다 현재 압박과 프로젝트 단계로 좁힙니다.", nextIntent: signalId },
        { label: "도구/환경으로 좁히기", description: "사용 중인 OS, 도구, 업무 흐름으로 좁힙니다.", nextIntent: signalId },
        { label: "성과 압박으로 좁히기", description: "이번 달 돈, 시간, 평판 압박으로 좁힙니다.", nextIntent: signalId },
      ],
    },
    reachable_person: {
      header: "직접 만날 사람",
      question: "이번 주 실제로 연락하거나 관찰할 수 있는 사람/계정은 누구인가요?",
      placeholder: "예: Threads에서 DM 가능한 @handle, 전 직장 동료 A, Indie Hackers 글 작성자",
      options: [
        { label: "이미 아는 사람", description: "이름이나 관계가 있어 바로 연락 가능합니다.", nextIntent: signalId },
        { label: "온라인 계정", description: "DM, 댓글, 커뮤니티로 접근 가능합니다.", nextIntent: signalId },
        { label: "관찰 가능한 사용자", description: "직접 인터뷰 전에도 작업 흔적을 볼 수 있습니다.", nextIntent: signalId },
      ],
    },
    current_alternative: {
      header: "기존의 방식",
      question: "그 사람은 지금 이 문제를 어떤 수작업, 도구 조합, 우회 방식으로 해결하고 있나요?",
      placeholder: "예: Notion에 인터뷰 메모를 쓰고 Claude에게 매번 복사해 다음 행동을 묻는다",
      options: [
        { label: "수작업", description: "반복 복사, 정리, 추적 같은 손작업입니다.", nextIntent: signalId },
        { label: "기존 도구 조합", description: "여러 앱을 이어 붙여 해결합니다.", nextIntent: signalId },
        { label: "그냥 방치", description: "시도하지 않는 이유와 결과를 적어야 합니다.", nextIntent: signalId },
      ],
    },
    pressure_cost: {
      header: "고통과 시급성",
      question: "현재 대안 때문에 드는 비용을 시간, 돈, 평판 중 하나의 숫자로 적으면 얼마인가요?",
      placeholder: "예: 주 3시간 낭비, 월 20만원 도구비, 출시 2주 지연",
      options: [
        { label: "시간 비용", description: "주당/월당 낭비 시간을 적습니다.", nextIntent: signalId },
        { label: "돈 비용", description: "도구비, 외주비, 놓친 매출을 적습니다.", nextIntent: signalId },
        { label: "기회/평판 비용", description: "출시 지연, 공개 실패, 신뢰 하락을 적습니다.", nextIntent: signalId },
      ],
    },
    proof_target: {
      header: "Proof",
      question: "방금 정한 GOAL이 계속 밀어붙일 가치가 있다고 판단하려면 이번 주 어떤 증거가 필요하나요?",
      placeholder: "예: 전업 1인 개발자 3명이 첫 인터뷰 카드에 답하고 다음 미션을 저장한다",
      options: [
        { label: "문제 증거", description: "고객 후보가 이 문제를 실제로 겪고 지금 해결하려는지 봅니다.", nextIntent: signalId },
        { label: "수요 증거", description: "응답, 미팅, 결제 의향처럼 비용을 내는 pull을 봅니다.", nextIntent: signalId },
        { label: "사용 행동 증거", description: "누가 제품이나 수동 대안으로 핵심 행동을 끝냈는지 봅니다.", nextIntent: signalId },
      ],
    },
    metric: {
      header: "지표",
      question: "그 검증 기준을 어떤 숫자 하나로 판단할 건가요?",
      placeholder: "예: 인터뷰 카드 완료 3명, 답변 재시도율 50% 이하, 첫 미션 저장 2건",
      options: [
        { label: "완료 수", description: "몇 명/몇 건이 끝냈는지 봅니다.", nextIntent: signalId },
        { label: "전환율", description: "시작 대비 완료나 응답 비율을 봅니다.", nextIntent: signalId },
        { label: "시간/마찰", description: "완료까지 걸린 시간이나 실패 횟수를 봅니다.", nextIntent: signalId },
      ],
    },
    failure_condition: {
      header: "실패 조건",
      question: "이번 주 어떤 결과가 나오면 이 목표는 실패라고 판단하나요?",
      placeholder: "예: 연락 5명 중 0명이 과거 행동을 말하지 못하면 고객 후보를 다시 좁힌다",
      options: [
        { label: "응답 없음", description: "접근했지만 반응이 없는 경우입니다.", nextIntent: signalId },
        { label: "행동 증거 없음", description: "좋다는 말만 있고 과거 행동이 없습니다.", nextIntent: signalId },
        { label: "완료 실패", description: "제품/문서 흐름을 끝내지 못합니다.", nextIntent: signalId },
      ],
    },
    threshold: fallback,
    tradeoff: fallback,
    rejected_option: fallback,
    trigger: fallback,
    violation_example: fallback,
    user_workflow: fallback,
    mvp_wedge: fallback,
    non_goal: fallback,
    observable_success: fallback,
    core_risk: fallback,
  };

  return bySignal[signalId] || fallback;
}

function valuesFollowupCopyForSignal(signalId, state = null) {
  const latestAnswer = latestDocAnswerForFollowup(state, "values");
  if (!String(latestAnswer || "").trim()) {
    return null;
  }
  const tradeoff = parseValuesTradeoff(latestAnswer);
  const priority = tradeoff.priority || firstMeaningfulPhrase(latestAnswer) || "방금 정한 원칙";
  const deferred = tradeoff.deferred || "반대 선택지";
  const source = shortenSentence(latestAnswer, 72) || priority;
  const concreteOptions = (labels, descriptions) => labels.map((label, index) => ({
    label: shortenOptionLabel(label),
    description: descriptions[index],
    nextIntent: signalId,
  }));
  const bySignal = {
    tradeoff: {
      header: "포기할 선택",
      question: `"${source}" 원칙을 지키려고 이번 주 실제로 포기할 선택은 무엇인가요?`,
      placeholder: `예: ${deferred}보다 ${priority}을/를 먼저 끝낸다`,
      options: concreteOptions(
        [`${priority} 먼저`, `${deferred} 미루기`, `${priority} 없으면 중단`],
        [
          `방금 답한 원칙을 이번 주 첫 결정 기준으로 둡니다.`,
          `원칙과 충돌하는 선택지를 이번 주 범위 밖으로 뺍니다.`,
          `원칙을 확인할 증거가 없으면 문서 승인을 멈춥니다.`,
        ],
      ),
    },
    rejected_option: {
      header: "거절 기준",
      question: `"${source}" 원칙이 이번 주 명확히 거절해야 하는 요청은 무엇인가요?`,
      placeholder: `예: ${priority} 근거 없이 ${deferred}부터 하자는 요청은 거절한다`,
      options: concreteOptions(
        [`${deferred} 요청 거절`, `${priority} 없는 승인 거절`, `${deferred} 우선순위 거절`],
        [
          `방금 답한 원칙과 반대되는 요청을 차단합니다.`,
          `원칙을 뒷받침할 근거가 없으면 통과시키지 않습니다.`,
          `이번 주 우선순위가 원칙 밖으로 흐르는 것을 막습니다.`,
        ],
      ),
    },
    trigger: {
      header: "적용 상황",
      question: `"${source}" 원칙은 어떤 순간에 바로 적용하나요?`,
      placeholder: `예: ${priority} 근거가 안 보이면 ${deferred} 결정을 미룬다`,
      options: concreteOptions(
        [`${priority} 근거 없음`, `${deferred}가 앞설 때`, `${priority} 판단이 흔들릴 때`],
        [
          `원칙을 뒷받침하는 관찰이나 숫자가 없을 때 적용합니다.`,
          `반대 선택지가 우선순위를 밀어낼 때 적용합니다.`,
          `팀이나 사용자가 다음 행동을 고르지 못할 때 적용합니다.`,
        ],
      ),
    },
    violation_example: {
      header: "위반 예시",
      question: `"${source}" 원칙을 어긴 것으로 기록할 이번 주 행동은 무엇인가요?`,
      placeholder: `예: ${priority} 확인 없이 ${deferred}을/를 먼저 하면 위반이다`,
      options: concreteOptions(
        [`${priority} 없이 통과`, `${deferred}부터 실행`, `${priority} 근거 생략`],
        [
          `방금 답한 원칙이 문서 승인에 반영되지 않은 상태입니다.`,
          `원칙과 충돌하는 선택지를 먼저 실행하는 행동입니다.`,
          `근거를 남기지 않고 원칙만 선언하는 행동입니다.`,
        ],
      ),
    },
  };
  return bySignal[signalId] || null;
}

function latestDocAnswerForFollowup(state, docType) {
  const transcript = Array.isArray(state?.transcript) ? state.transcript : [];
  return [...transcript]
    .reverse()
    .find((entry) => entry?.docType === docType && String(entry?.responseText || "").trim())
    ?.responseText || "";
}

function parseValuesTradeoff(answer) {
  const text = normalizeRubricText(answer);
  const contrast = text.match(/(.{2,36}?)(?:보다|대신)\s+(.{2,36}?)(?:을|를|이|가)?\s*(?:우선|먼저|선택|지킨|집중)/);
  if (contrast) {
    return {
      deferred: cleanupValuesPhrase(contrast[1]),
      priority: cleanupValuesPhrase(contrast[2]),
    };
  }
  const priority = text.match(/(.{2,36}?)(?:을|를|이|가)?\s*(?:우선|먼저|지킨|집중|선택)/);
  return {
    deferred: "",
    priority: cleanupValuesPhrase(priority?.[1] || text),
  };
}

function firstMeaningfulPhrase(answer) {
  return cleanupValuesPhrase(
    normalizeRubricText(answer)
      .split(/[.!?\n。]| — |,|，/)
      .map((part) => part.trim())
      .find((part) => part.length >= 2) || "",
  );
}

function cleanupValuesPhrase(value) {
  return String(value || "")
    .replace(/^(선택:|근거:|예:)\s*/i, "")
    .replace(/\s*(한다|합니다|이에요|입니다|우선한다|선택한다|지킨다)\s*$/g, "")
    .trim()
    .slice(0, 28);
}

function shortenOptionLabel(label) {
  const value = String(label || "").replace(/\s+/g, " ").trim();
  return value.length > 24 ? `${value.slice(0, 23)}…` : value;
}

function genericIddInitialOptionsFor(doc, { focus = "" } = {}) {
  if (doc?.type === "designSystem") {
    return [
      {
        label: "현재 화면부터 정리",
        description: "지금 보이는 화면을 기준으로 정보 계층을 고정합니다.\n[상단: 오늘 할 일] -> [본문: 질문] -> [하단: 다음 행동]",
        nextIntent: "document_current_workflow",
      },
      {
        label: "선택지 모양부터 정리",
        description: "복잡한 질문을 한눈에 고르는 작은 카드로 바꿉니다.\n[질문]  [선택 A] [선택 B] [기타 입력]",
        nextIntent: "document_nearest_action",
      },
      {
        label: "시안 비교가 필요한 곳 표시",
        description: "말로 부족한 화면은 실제 시안이나 ASCII 예시로 비교할 후보를 남깁니다.\nA: 업무형  B: 카드형  C: 대화형",
        nextIntent: "document_visual_examples",
      },
      {
        label: "아직 모르겠어요",
        description: "먼저 사용자가 멈추는 장면만 그림으로 남깁니다.\n사용자 선택 -> 응답 대기 -> 다음 질문",
        nextIntent: "document_unknown",
      },
    ];
  }

  return [
    {
      label: "지금 하는 방식부터 정리",
      description: `이미 하는 방식과 기록 흐름을 기준으로 ${focus}를 정리해, 지금의 실제 상태를 고정합니다.`,
      nextIntent: "document_current_workflow",
    },
    {
      label: "이번 주 실행 기준부터 정리",
      description: "오늘 바로 쓸 수 있는 최소 규칙과 완료 조건을 정해, 다음 행동이 멈추지 않게 합니다.",
      nextIntent: "document_nearest_action",
    },
    {
      label: "나중에 깨질 지점부터 막기",
      description: "기준이 비어 있거나 잘못 쓰였을 때 실제로 깨지는 지점을 먼저 막습니다.",
      nextIntent: "document_failure_modes",
    },
    {
      label: "아직 모르겠어요",
      description: "확정 대신 후보와 질문을 남기고 다음 인터뷰에서 좁힙니다.",
      nextIntent: "document_unknown",
    },
  ];
}

export function genericIddUserFacingTitle(doc) {
  switch (doc?.type) {
    case "spec":
      return "이번 주 만들 것";
    case "values":
      return "결정 원칙";
    case "designSystem":
      return "화면 원칙";
    case "adr":
      return "기술 결정";
    case "goal":
      return "목표와 지표";
    case "docs":
      return "문서 지도";
    case "sheet":
      return "공개 기록 기준";
    default:
      return "프로젝트 기준";
  }
}

function genericIddUserFacingFocus(doc) {
  switch (doc?.type) {
    case "spec":
      return "문제, 가치, 만들 범위, 사용자 흐름, 성공 기준";
    case "values":
      return "결정 원칙, 하지 않을 일, 판단 예시";
    case "designSystem":
      return "화면 원칙, 컴포넌트, 상호작용, 접근성 기준";
    case "adr":
      return "기술 선택, 버린 대안, 결과와 책임";
    case "goal":
      return "목표, 지표, 주간 마일스톤, 운영 리듬";
    case "docs":
      return "문서 목록, 진짜 기준 문서, 새 사람이 읽는 순서, 유지 규칙";
    case "sheet":
      return "공개 글 기록 열, 증거 기록 흐름, 품질 체크 기준";
    default:
      return "문서의 목적, 독자, 완료 기준";
  }
}

function genericIddPurposeFor(doc, canonicalPath, focus) {
  switch (doc?.type) {
    case "spec":
      return "문제, 가치, 첫 버전 범위, 성공 기준을 한곳에 묶어 이번 주에 무엇을 만들지 흐리지 않게 하는 것";
    case "values":
      return "결정 원칙과 하지 않을 일을 정해서 매번 취향이나 기분으로 방향이 바뀌지 않게 하는 것";
    case "designSystem":
      return "화면 원칙, 컴포넌트, 접근성 기준을 정해 구현자가 임의로 UI를 만들지 않게 하는 것";
    case "adr":
      return "기술 결정을 왜 했는지와 버린 대안을 남겨 같은 논쟁을 반복하지 않게 하는 것";
    case "goal":
      return "목표, 지표, 주간 리듬을 정해 오늘 일이 실제 진척인지 확인할 수 있게 하는 것";
    case "docs":
      return "어떤 문서를 어디서 읽고 고치는지 정해 프로젝트 지식이 흩어지지 않게 하는 것";
    case "sheet":
      return "공개 글의 기록 열, 증거 기록 흐름, 품질 체크 기준을 정해 공개 실행을 추적할 수 있게 하는 것";
    default:
      return `${canonicalPath}에 ${focus}를 적어 다음 실행 기준으로 쓰게 하는 것`;
  }
}

function genericIddRiskFor(doc, canonicalPath) {
  switch (doc?.type) {
    case "sheet":
      return "이 기준이 없으면 글을 올려도 무엇을 배웠는지, 어떤 증거가 쌓였는지, 다음에 무엇을 고쳐야 하는지 놓칩니다.";
    case "spec":
      return "이 기준이 없으면 기능은 늘어나도 사용자가 겪는 실제 문제가 해결됐는지 알기 어렵습니다.";
    case "designSystem":
      return "이 기준이 없으면 화면마다 판단이 달라져 사용자가 같은 제품이라고 느끼기 어렵습니다.";
    default:
      return `이 기준이 없으면 ${canonicalPath}가 문서 저장소의 파일 하나로 남고 실제 문제 해결에는 연결되지 않습니다.`;
  }
}

function buildAdaptiveQuestion(hypothesis, primaryUser, projectKind) {
  const productName = sentenceField(userFacingProductName(hypothesis.productName));
  const currentIcp = sentenceField(hypothesis.targetUser || primaryUser);
  if (isAgentic30IcpContext(hypothesis, primaryUser)) {
    return "이번 주 가장 먼저 인터뷰할 1인 개발자 유형은 누구인가요?";
  }
  if (hypothesis.confidence === "high" && currentIcp) {
    return `이번 주 가장 먼저 인터뷰할 ${targetSegmentFragment(currentIcp)} 유형은 누구인가요?`;
  }
  if (hypothesis.confidence === "medium" && (productName || currentIcp || primaryUser)) {
    const segment = shortenSentence(currentIcp || primaryUser || "잠재 고객", 56);
    return `이번 주 먼저 만날 ${segment} 유형은 누구인가요?`;
  }
  return "이번 주 가장 먼저 인터뷰할 고객 유형은 누구인가요?";
}

function buildAdaptiveHelperText(hypothesis) {
  const primaryUser = hypothesis.likelyUsers?.[0] || "";
  if (isAgentic30IcpContext(hypothesis, primaryUser)) {
    return "만들 수는 있지만 팔릴 방향을 못 잡고 있는 사람 중, 실제로 연락 가능한 대상을 고릅니다.";
  }
  const parts = [];
  const productName = userFacingProductName(hypothesis.productName);
  if (productName) parts.push(`제품: ${shortenSentence(productName, 28)}`);
  if (hypothesis.targetUser || primaryUser) parts.push(`대상: ${targetSegmentFragment(hypothesis.targetUser || primaryUser)}`);
  if (hypothesis.problem) parts.push(`문제: ${problemFocusFragment(hypothesis.problem)}`);
  if (parts.length === 0) return "먼저 첫 고객 후보 하나만 고릅니다.";
  return `${parts.join(" · ")}. 이 맥락에서 첫 고객 후보 하나만 고릅니다.`;
}

function problemFocusFragment(value) {
  const text = String(value || "").trim();
  const firstClause = text.split(/[.,，、。]/)[0]?.trim() || text;
  return shortenSentence(firstClause, 46);
}

function targetSegmentFragment(value) {
  const text = String(value || "").trim();
  const parts = text
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) return shortenSentence(parts.slice(0, 2).join(", "), 46);
  return shortenSentence(text, 46);
}

function userFacingProductName(value) {
  const name = String(value || "").trim();
  if (!name) return "";
  if (/workspace-[a-z0-9]{4,}$/i.test(name)) return "";
  if (/^(tmp|temp|test)[-_]/i.test(name)) return "";
  return name;
}

function buildAdaptiveOptions({ hypothesis, primaryUser, onboardingContext }) {
  if (isAgentic30IcpContext(hypothesis, primaryUser)) {
    return [
      {
        label: "퇴사 후 첫 매출이 없는 개발자",
        description: "만들 수는 있지만 팔 대상과 첫 고객 증거가 없어 이번 달 압박이 큽니다.",
        nextIntent: "full_time_zero_revenue_indie",
      },
      {
        label: "AI로 제품은 만들었지만 고객이 없는 개발자",
        description: "Codex/Claude로 만들었지만 인터뷰, 수요 검증, 다음 행동이 비어 있습니다.",
        nextIntent: "agent_built_mvp_no_customers",
      },
      {
        label: "여러 번 출시했지만 반응이 약했던 개발자",
        description: "반복 실패 뒤 방법을 바꿀 동기가 있어 첫 인터뷰 반응을 보기 좋습니다.",
        nextIntent: "repeat_launch_weak_signal",
      },
    ];
  }

  const currentIcp = hypothesis?.targetUser || primaryUser || defaultSelfOptionLabel(onboardingContext);
  const productName = hypothesis?.productName || "이 제품";
  const problem = hypothesis?.problem || "";
  return [
    {
      label: `${shortenLabel(currentIcp)} 중 지금 막힌 사람`,
      description: problem
        ? `${shortenSentence(problem, 54)} 때문에 이번 주 압박이 큰 사람입니다.`
        : "이번 주 돈, 시간, 평판 중 하나가 이미 압박합니다.",
      nextIntent: "urgent_icp",
    },
    {
      label: `${shortenLabel(productName)} 대안을 이미 쓰는 사람`,
      description: "수작업이나 다른 툴 조합으로 같은 일을 이미 처리하고 있습니다.",
      nextIntent: "existing_alternative",
    },
    {
      label: "돈이나 시간을 이미 쓰는 사람",
      description: "예산, 일정, 반복 업무 시간이 걸려 있어 신호가 강합니다.",
      nextIntent: "budget_or_time_committed",
    },
  ];
}

function isAgentic30IcpContext(hypothesis, primaryUser) {
  const text = [
    hypothesis?.productName,
    hypothesis?.targetUser,
    hypothesis?.problem,
    hypothesis?.purpose,
    primaryUser,
  ].join(" ").toLowerCase();
  return text.includes("agentic30")
    || /전업\s*1인\s*개발자/.test(text)
    || (/수익\s*0원/.test(text) && /macos|mac\s*os|mac/.test(text));
}

function defaultSelfOptionLabel(onboardingContext) {
  const role = String(onboardingContext?.role || "").trim();
  if (role === "designer") return "나 같은 디자이너";
  if (role === "product_manager") return "나 같은 PM";
  if (role === "marketer_business") return "나 같은 마케터/비즈니스 담당자";
  if (role === "generalist") return "나처럼 여러 역할을 맡은 사람";
  if (role === "student") return "나 같은 학생";
  return "나 또는 우리 팀";
}

function freeTextPlaceholderFor(primaryUser, hypothesis = null) {
  if (isAgentic30IcpContext(hypothesis, primaryUser)) {
    return "예: 퇴사 후 3개월째, AI로 첫 버전은 만들었지만 유료 고객이 없는 개발자";
  }
  if (primaryUser) {
    return `예: ${shortenLabel(primaryUser)} 중 이번 주 바로 연락 가능한 사람`;
  }
  return "예: 퇴사 후 아직 첫 매출이 없는 1인 개발자";
}

function sentenceField(value) {
  return stripTrailingPunctuation(stripInlineMarkdown(value));
}

function stripInlineMarkdown(value) {
  return String(value || "")
    .replace(/[`*_]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingPunctuation(value) {
  return String(value || "").replace(/[.。．]+$/u, "").trim();
}

function shortenSentence(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function naturalEvidenceLead(evidence = []) {
  const joined = evidence.join(" ").toLowerCase();
  if (joined.includes("readme") && joined.includes("최근 변경")) return "README와 최근 변경을 보면";
  if (joined.includes("readme")) return "README를 보면";
  if (joined.includes("package.json")) return "package.json을 보면";
  if (joined.includes("spec") || joined.includes("docs") || joined.includes("values")) return "프로젝트 문서를 보면";
  if (joined.includes("최근 변경")) return "최근 변경을 보면";
  return "프로젝트를 훑어보면";
}

function projectKindLabel(projectKind) {
  switch (projectKind) {
    case "mac_app":
      return "macOS 앱";
    case "web_app":
      return "웹 앱";
    case "developer_tool":
      return "개발자 도구";
    case "node_app":
      return "Node.js 프로젝트";
    case "strategy_docs":
      return "전략 문서 프로젝트";
    default:
      return "프로젝트";
  }
}

function shortenLabel(value) {
  const text = String(value || "").trim();
  if (text.length <= 22) return text;
  return `${text.slice(0, 21).trim()}…`;
}

export function buildIddContinuationPrompt({
  iddPrompt,
  structuredResponseText = "",
  specialistInjection = "",
} = {}) {
  const answer = String(structuredResponseText || "").trim();
  const specialistBlock = specialistInjection
    ? String(specialistInjection).trim()
    : [
        "- office-hours 방식: 실제 수요, 현재 대안, 가장 절박한 사람, 가장 작은 유료/사용 가능 진입점을 묻고 추상 답변이면 실제 사람/상황/증거로 좁히세요.",
        "- plan-ceo-review 방식: 선택지에는 최소안, 이상안, 다른 관점을 함께 두고 추천 이유와 우선순위 선택을 설명하세요.",
        "- design-review 방식: 관찰한 UI/문서/흐름을 놓고 'I notice / I wonder / What if / I think because' 구조로 증거 기반 후속 질문을 만드세요.",
        "- devex-review 방식: Time to Hello World, 다음 행동의 명확성, 에러가 문제/원인/해결책을 알려주는지처럼 측정 가능한 개발자 경험 기준을 묻고 점수나 기준을 남기세요.",
      ].join("\n");
  return [
    iddPrompt,
    "",
    "## 직전 구조화 답변",
    "사용자가 host UI의 구조화 입력 카드에서 직전 IDD 질문에 답했습니다.",
    answer || "(응답 텍스트 없음)",
    "",
    "이 답변을 인터뷰 입력으로 사용하세요. 방금 답한 질문이나 같은 선택지 라벨을 반복하지 마세요.",
    "다음 질문은 반드시 현재 프로젝트의 실제 맥락에 맞춰 맞춤 인터뷰로 새로 생성하세요.",
    "- 먼저 README, `.agentic30/docs/*`, package/config, 주요 소스, 최근 git 변경에서 관찰한 사실을 조합해 제품/사용자/제약 가설을 세우세요.",
    "- 질문은 제품 이름, 대상 유저, 해결 문제, 제품 목적을 확인한 뒤 그 진단의 가장 약한 부분을 검증하는 한 가지로 좁히고 question/options/freeTextPlaceholder에 관찰한 프로젝트 맥락을 반영하세요.",
    "- 어떤 프로젝트에도 붙일 수 있는 범용 질문이나 템플릿 질문을 반복하지 마세요.",
    "- 좋은 질문은 gstack review flow처럼 decision brief여야 합니다. 사용자가 무엇을 결정해야 하는지, 잘못 고르면 무엇이 깨지는지, 추천 선택지는 무엇인지 한 번에 보이게 만드세요.",
    "",
    specialistBlock,
    "",
    "- gstack 정렬 축을 매 질문에 적용하세요: 톤은 직접적이고 증거 중심, 단위는 한 질문=한 결정, 기준은 수요/범위/UX/DX/리스크, 사용 위치는 공개 기록 문서 완성 직전의 기준, 실패 방지는 범용 문서/빈 결정/조용한 누락 차단입니다.",
    "- 대안/리스크/증거/실패 모드가 보이지 않는 질문은 좋은 IDD 질문이 아닙니다. 더 좁혀서 무엇을 선택해야 하는지, 어떤 근거가 있는지, 잘못 고르면 어떤 문서 실패가 생기는지 드러내세요.",
    "- 답변은 반드시 대상 문서의 섹션, 결정, Open Risks, 다음 공개 기록 글감 중 하나로 연결하세요.",
    `- 추가 결정이나 누락 정보가 필요하면 반드시 ${CODEX_STRUCTURED_INPUT_TOOL} 도구 연결로 한 질문 + 2-4개 후보 options + allowFreeText: true + freeTextPlaceholder를 담아 이어가세요. 사용자는 선택지 또는 기타 자유 입력 중 하나로 답할 수 있습니다. 이 구조화 입력은 host UI에서 request_user_input 카드로 표시됩니다.`,
    "- 도구 호출 자체가 실패하면 같은 질문을 prose/번호 목록으로 대신 출력하지 말고 중단하세요.",
    "- Pushback 즉시 적용: 사용자의 답이 \"개발자/창업자/엔터프라이즈\" 같은 집합명사이면 다음 question을 회사명·직함·주당 시간으로 좁히고 \"다들 좋다고 한다/대기 신청자가 있다\" 류 사회적 증거이면 결제·문의·고장 시 분노로 받고 \"풀 플랫폼이 필요하다\" 류 광범위 비전이면 이번 주 결제 가능한 한 가지로 좁히세요. 사랑은 수요가 아닙니다.",
    "- Anti-Sycophancy: \"흥미로운 접근이에요\", \"여러 방법이 있어요\" 같은 칭찬 표현은 금지. 정중체는 유지하되 \"이 가정은 미확인이에요\" / \"근거가 부족해요\" 같은 사실 진술로 받으세요.",
  ].join("\n");
}

export function findRequiredLocalDocs(workspaceRoot, { fsImpl = fsSync } = {}) {
  return BIP_REQUIRED_LOCAL_DOCS.map((doc) => {
    const foundPath = docPathExists(workspaceRoot, doc.canonicalPath, fsImpl) ? doc.canonicalPath : null;

    return {
      ...doc,
      found: Boolean(foundPath),
      foundPath,
    };
  });
}

export function findRequiredLocalDocsWithConfig(workspaceRoot, { bipConfig = null, fsImpl = fsSync } = {}) {
  return BIP_REQUIRED_LOCAL_DOCS.map((doc) => {
    const configuredPath = normalizeConfiguredDocPath(bipConfig?.workspace?.[doc.type], workspaceRoot);
    const foundPath = docPathExists(workspaceRoot, doc.canonicalPath, fsImpl) ? doc.canonicalPath : null;

    return {
      ...doc,
      configuredPath,
      found: Boolean(foundPath),
      foundPath,
    };
  });
}

function docPathExists(workspaceRoot, relativePath, fsImpl) {
  try {
    const stat = fsImpl.statSync(path.join(workspaceRoot, relativePath));
    return stat.isFile();
  } catch {
    return false;
  }
}

function normalizeConfiguredDocPath(value, workspaceRoot) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0")) return null;
  const root = path.resolve(workspaceRoot || ".");
  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(root, trimmed);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return path.relative(root, resolved).split(path.sep).join(path.posix.sep);
}

export function deriveLocalDocReadinessRows(workspaceRoot, options = {}) {
  const iddState = options.iddSetupState ? normalizeIddSetupState(options.iddSetupState) : null;
  if (iddState) {
    return IDD_FOUNDATION_DOCS.map((doc) => ({
      id: localDocRowId(doc.type),
      status: iddState.status === "approved" ? "done" : (iddState.drafts?.[doc.type]?.trim() ? "in-progress" : "pending"),
      detail: iddState.status === "approved"
        ? `${doc.title} 문서 승인됨: ${doc.canonicalPath}`
        : `${doc.canonicalPath} 문서를 초기 설정에서 승인해야 해요.`,
      ...(iddState.status === "approved" ? { resourceName: doc.title, resourceUrl: doc.canonicalPath } : {}),
    }));
  }
  return IDD_FOUNDATION_DOCS.map((doc) => ({
    id: localDocRowId(doc.type),
    status: "pending",
    detail: `${doc.canonicalPath} 문서를 초기 설정에서 승인해야 해요.`,
  }));
}

export function localDocRowId(type) {
  return `local${String(type || "").slice(0, 1).toUpperCase()}${String(type || "").slice(1)}`;
}

export function docTypeFromLocalRowId(rowId) {
  const normalized = String(rowId || "").trim();
  if (!normalized.startsWith("local")) return null;
  const suffix = normalized.slice("local".length);
  if (!suffix) return null;
  const type = suffix.slice(0, 1).toLowerCase() + suffix.slice(1);
  return IDD_FOUNDATION_DOCS.some((doc) => doc.type === type)
    || BIP_REQUIRED_LOCAL_DOCS.some((doc) => doc.type === type)
    ? type
    : null;
}

export function requiredDocByType(type) {
  return IDD_FOUNDATION_DOCS.find((doc) => doc.type === type)
    || BIP_REQUIRED_LOCAL_DOCS.find((doc) => doc.type === type)
    || null;
}

export function getBipSetupGateStatus({ workspaceRoot, bipCoachState, bipConfig = null, fsImpl = fsSync } = {}) {
  const localDocs = findRequiredLocalDocsWithConfig(workspaceRoot, { bipConfig, fsImpl });
  const missingLocalDocs = localDocs.filter((doc) => !doc.found);
  const config = bipCoachState?.config ?? {};
  const missingExternalRequirements = [];

  if (!config.docId) {
    missingExternalRequirements.push({
      id: "googleDoc",
      title: "Google Doc 업무일지",
      detail: "매일 작업과 배운 점을 읽을 Google Doc URL/ID가 연결되어야 해요.",
    });
  }
  if (!config.sheetId) {
    missingExternalRequirements.push({
      id: "googleSheet",
      title: "Google Sheet 게시글 일지",
      detail: "공개 글과 반응을 기록할 Google Sheet URL/ID가 연결되어야 해요.",
    });
  }

  return {
    ready: missingLocalDocs.length === 0 && missingExternalRequirements.length === 0 && isBipCoachConfigured(bipCoachState),
    localDocs,
    missingLocalDocs,
    missingExternalRequirements,
    nextLocalDoc: missingLocalDocs[0] || null,
  };
}

export function summarizeBipSetupGate(status) {
  if (status?.iddSetupStatus && status.iddSetupStatus !== "approved") {
    const nextTitle = status.nextLocalDoc ? genericIddUserFacingTitle(status.nextLocalDoc) : "문서 미리보기";
    return `초기 설정이 먼저 필요합니다. ${nextTitle} 기준을 승인해야 오늘 미션을 만들 수 있어요.`;
  }
  const missingLocal = (status?.missingLocalDocs ?? []).map((doc) => genericIddUserFacingTitle(doc)).join(", ");
  const missingExternal = (status?.missingExternalRequirements ?? []).map((item) => item.title).join(", ");
  const parts = [];
  if (missingLocal) parts.push(`로컬 문서: ${missingLocal}`);
  if (missingExternal) parts.push(`외부 연결: ${missingExternal}`);
  return parts.length
    ? `초기 검증 문서는 승인되었습니다. ${parts.join(" / ")} 연결은 추천 품질을 높이는 선택 단계입니다.`
    : "오늘 공개 실행 준비가 완료되었습니다.";
}

export function buildIddSetupGateStatus({
  workspaceRoot,
  iddSetupState,
  bipCoachState,
  bipConfig = null,
  fsImpl = fsSync,
} = {}) {
  const normalizedIdd = normalizeIddSetupState(iddSetupState);
  const approved = isIddSetupApproved(normalizedIdd);
  const localDocs = IDD_FOUNDATION_DOCS.map((doc) => ({
    ...doc,
    found: approved,
    foundPath: approved ? doc.canonicalPath : null,
  }));
  const missingLocalDocs = approved ? [] : IDD_FOUNDATION_DOCS.filter((doc) => !normalizedIdd.drafts?.[doc.type]?.trim());
  const config = bipCoachState?.config ?? {};
  const missingExternalRequirements = [];

  if (!config.docId) {
    missingExternalRequirements.push({
      id: "googleDoc",
      title: "Google Doc 업무일지",
      detail: "매일 작업과 배운 점을 읽을 Google Doc URL/ID가 연결되어야 해요.",
    });
  }
  if (!config.sheetId) {
    missingExternalRequirements.push({
      id: "googleSheet",
      title: "Google Sheet 게시글 일지",
      detail: "공개 글과 반응을 기록할 Google Sheet URL/ID가 연결되어야 해요.",
    });
  }

  return {
    ready: approved,
    iddSetupComplete: approved,
    iddSetupStatus: normalizedIdd.status,
    iddCurrentDocType: normalizedIdd.currentDocType,
    iddAmbiguityScore: normalizedIdd.ambiguityScore,
    iddAmbiguityRubric: normalizedIdd.ambiguityRubric,
    iddUnresolvedAssumptions: normalizedIdd.unresolvedAssumptions,
    iddDocOrder: IDD_FOUNDATION_DOC_TYPES,
    iddDocPreviews: buildIddDocPreviews(normalizedIdd),
    iddProviderRecovery: normalizedIdd.providerRecovery,
    iddSetupError: normalizedIdd.setupError,
    localDocs,
    missingLocalDocs,
    missingExternalRequirements,
    nextLocalDoc: nextIddFoundationDoc(normalizedIdd),
    externalReady: missingExternalRequirements.length === 0 && isBipCoachConfigured(bipCoachState),
    workspaceRoot,
    bipConfig,
    fsImpl,
  };
}

export function serializeIddSetupFields(state) {
  const normalized = normalizeIddSetupState(state);
  return {
    iddSetupStatus: normalized.status,
    iddSetupComplete: normalized.status === "approved",
    iddCurrentDocType: normalized.currentDocType,
    iddAmbiguityScore: normalized.ambiguityScore,
    iddAmbiguityRubric: normalized.ambiguityRubric,
    iddUnresolvedAssumptions: normalized.unresolvedAssumptions,
    iddDocOrder: IDD_FOUNDATION_DOC_TYPES,
    iddDocPreviews: buildIddDocPreviews(normalized),
    iddProviderRecovery: normalized.providerRecovery,
    iddSetupError: normalized.setupError,
  };
}

export function calculateIddAmbiguityRubric(state = {}) {
  const transcript = Array.isArray(state.transcript) ? state.transcript : [];
  const drafts = state.drafts && typeof state.drafts === "object" && !Array.isArray(state.drafts)
    ? state.drafts
    : {};
  const docs = IDD_FOUNDATION_DOCS.map((doc) => {
    const docTranscriptEntries = transcript.filter((entry) => entry?.docType === doc.type);
    const docTranscript = docTranscriptEntries
      .map((entry) => entry?.responseText || "")
      .filter(Boolean);
    // Gate text additionally includes responseDescription so signalPasses sees
    // the keywords the AI option synthesizer puts in descriptions (DM, 인터뷰,
    // 시간, 매출, ...) — labels alone almost never carry them and would force
    // the repeated-answer auto-pass fallback to fire twice per signal. Other
    // consumers (transcript display, ICP.md draft, previousAnswerLabel slice)
    // keep using docTranscript which stays label-only.
    const docGateTexts = docTranscriptEntries
      .map((entry) => [entry?.responseText, entry?.responseDescription]
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join(" "))
      .filter(Boolean);
    const gateText = [
      ...(docGateTexts.length ? docGateTexts : [drafts[doc.type] || ""]),
    ].join("\n");
    const signals = IDD_RUBRIC_SIGNALS[doc.type] || [];
    const autoPassed = autoPassSignalsFromRepeatedAnswers(
      doc.type,
      docTranscript.length,
      docTranscript,
      docTranscriptEntries,
    );
    const passedSignals = signals.filter((signal) =>
      signalPasses(signal.id, gateText) || autoPassed.has(signal.id),
    );
    const missingSignals = signals.filter((signal) =>
      !signalPasses(signal.id, gateText) && !autoPassed.has(signal.id),
    );
    const score = signals.length
      ? Math.round((missingSignals.length / signals.length) * 100)
      : 0;
    return {
      type: doc.type,
      title: doc.title,
      score,
      blocked: score > IDD_AMBIGUITY_THRESHOLD,
      passedSignals: passedSignals.map(({ id, label, dimension }) => ({ id, label, dimension })),
      missingSignals: missingSignals.map(({ id, label, dimension }) => ({ id, label, dimension })),
    };
  });

  const allSignals = docs.flatMap((doc) => [
    ...doc.passedSignals.map((signal) => ({ ...signal, passed: true, docType: doc.type })),
    ...doc.missingSignals.map((signal) => ({ ...signal, passed: false, docType: doc.type })),
  ]);
  const missingSignals = allSignals.filter((signal) => !signal.passed);
  const score = allSignals.length
    ? Math.round((missingSignals.length / allSignals.length) * 100)
    : 100;
  const dimensions = IDD_DIMENSIONS.map((dimension) => {
    const signals = allSignals.filter((signal) => signal.dimension === dimension.id);
    const missing = signals.filter((signal) => !signal.passed);
    return {
      ...dimension,
      score: signals.length ? Math.round((missing.length / signals.length) * 100) : 0,
      missingSignals: missing.map(({ id, label, docType }) => ({ id, label, docType })),
    };
  });
  const unresolvedAssumptions = docs
    .flatMap((doc) => doc.missingSignals.map((signal) => `${doc.title}: ${signal.label}`))
    .slice(0, 12);

  return {
    score,
    threshold: IDD_AMBIGUITY_THRESHOLD,
    blocked: score > IDD_AMBIGUITY_THRESHOLD,
    docs,
    dimensions,
    unresolvedAssumptions,
  };
}

function emptyIddAmbiguityRubric() {
  return calculateIddAmbiguityRubric({ transcript: [], drafts: {} });
}

function autoPassSignalsFromRepeatedAnswers(docType, answerCount, answersText = [], entries = []) {
  // Break ICP infinite loops: when the user has already answered the same
  // rubric signal 2+ times via clickable options, treat that signal as
  // resolved so the host advances to the next one. Without this, sidecar-
  // synthesized option labels (which often miss the strict keyword regex in
  // signalPasses) keep failing and the host/agent re-asks the same dimension
  // forever. narrow_segment had this guard from the start (label≤17 chars vs.
  // length≥18 gate); reachable_person/current_alternative/pressure_cost get
  // the same treatment so picking 2 reasonable options always advances.
  //
  // Guard: do not auto-pass when every answer is a bare generic noun like
  // "개발자" / "사용자" — those are genuinely ambiguous ICPs that should keep
  // the current card alive instead of falsely advancing.
  if (docType !== "icp") return new Set();
  const genericOnly = /^(개발자|창업자|사용자|고객|팀|회사|developer|founder|user|customer)s?\s*$/i;
  const passed = new Set();

  if (answerCount >= 2) {
    const anyConcrete = (Array.isArray(answersText) ? answersText : []).some(
      (text) => !genericOnly.test(String(text || "").trim()),
    );
    if (anyConcrete) passed.add("narrow_segment");
  }

  const safeEntries = Array.isArray(entries) ? entries : [];
  for (const signalId of ["reachable_person", "current_alternative", "pressure_cost"]) {
    const signalEntries = safeEntries.filter(
      (entry) => entry && entry.signalId === signalId,
    );
    if (signalEntries.length < 2) continue;
    const anyConcrete = signalEntries.some((entry) => {
      const trimmed = String(entry?.responseText || "").trim();
      return trimmed.length > 0 && !genericOnly.test(trimmed);
    });
    if (anyConcrete) passed.add(signalId);
  }

  return passed;
}

// Keyword patterns used to verify that an LLM-synthesized question actually
// targets the rubric signal it was supposed to address. Each pattern collects
// the dimension-specific words that appear in genuine on-topic copy (signal
// passes regex above, dimension label, follow-up card header). Used at the
// caller after parseIddAgentSynthesis to reject drift before showing the
// card to the user (F1).
const IDD_SIGNAL_KEYWORD_PATTERNS = {
  narrow_segment: /(좁히|세그먼트|구체|상황|특정|범위)/i,
  reachable_person: /(이름|연락|dm|인터뷰|만날|만날 사람|직접 만날|계정|@|님|동료|친구|커뮤니티|handle|person|account|reach)/i,
  current_alternative: /(현재|대안|기존|기존의 방식|기존 방식|우회|수작업|스프레드시트|엑셀|노션|notion|slack|툴|도구|쓰고|사용|복사|status quo|alternative|manual|workflow)/i,
  pressure_cost: /(시간|돈|비용|평판|압박|매출|원|달러|주당|월당|지연|낭비|고통|시급|cost|hour|minute|revenue)/i,
};

// Drop semantic duplicates: same scenario phrased two ways. Triggered when
// the agent emits one option and the host fallback merges another that
// means the same thing (e.g., "AI로 MVP만 만든 개발자" vs "AI로 제품은 만들었지만
// 고객이 없는 개발자"). Jaccard-match on label+description content tokens
// with Korean stop suffixes stripped.
export function dedupeIddAgentOptions(options) {
  if (!Array.isArray(options) || options.length <= 1) {
    return Array.isArray(options) ? options : [];
  }
  const tokenSets = options.map((option) =>
    iddOptionContentTokens(`${option?.label || ""} ${option?.description || ""}`),
  );
  const result = [];
  const kept = [];
  for (let i = 0; i < options.length; i++) {
    const tokens = tokenSets[i];
    const isDuplicate = kept.some((priorTokens) => iddOptionTokenJaccard(tokens, priorTokens) >= 0.4);
    if (isDuplicate) continue;
    kept.push(tokens);
    result.push(options[i]);
  }
  return result;
}

export function iddOptionContentTokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[.,!?·…/\\(){}[\]"'`*_~+\-—]/g, " ")
      .split(/\s+/)
      .map((token) =>
        token
          .replace(/(개발자|사용자|유저|팀|회사)$/u, "")
          .replace(/(은|는|이|가|을|를|로|으로|에|에서|과|와|도|만|의|만의|들의|에게|한테)$/u, ""),
      )
      .filter((token) => token.length >= 2),
  );
}

export function iddOptionTokenJaccard(a, b) {
  if (!a?.size || !b?.size) return 0;
  let intersect = 0;
  for (const token of a) if (b.has(token)) intersect += 1;
  return intersect / (a.size + b.size - intersect);
}

export function agentSynthesisTargetsCorrectSignal({ question, options, expectedSignalId } = {}) {
  if (!expectedSignalId) return true;
  const pattern = IDD_SIGNAL_KEYWORD_PATTERNS[expectedSignalId];
  if (!pattern) return true;
  const haystack = [
    String(question || ""),
    ...(Array.isArray(options) ? options : []).flatMap((option) => [
      option?.label,
      option?.description,
    ]),
  ]
    .filter(Boolean)
    .join(" ");
  return pattern.test(haystack);
}

function signalPasses(signalId, text) {
  const value = normalizeRubricText(text);
  if (!value) return false;
  switch (signalId) {
    case "narrow_segment":
      return value.length >= 18 && !/^(개발자|창업자|사용자|고객|팀|회사|developer|founder|user|customer)s?$/i.test(value);
    case "reachable_person":
      return /(이름|연락|dm|인터뷰|만날|계정|@|님|회사|팀|동료|친구|커뮤니티|handle|person|account|reach)/i.test(value);
    case "current_alternative":
      return /(현재|대안|우회|수작업|스프레드시트|엑셀|노션|notion|slack|툴|도구|쓰고|사용|복사|status quo|alternative|manual|workflow)/i.test(value);
    case "pressure_cost":
      return hasNumber(value) || /(시간|분|돈|비용|평판|압박|매출|원|달러|주당|월당|지연|낭비|cost|hour|minute|revenue)/i.test(value);
    case "proof_target":
      return /(이번 주|주간|proof|검증|확인|목표|마일스톤|증명|완료|week)/i.test(value);
    case "metric":
      return /(지표|metric|전환|응답|reply|매출|결제|사용|활성|숫자|완료|conversion|rate|count|%)/i.test(value);
    case "threshold":
      return hasNumber(value) || /(이하|이상|까지|기한|deadline|target|기준값|목표값|threshold)/i.test(value);
    case "failure_condition":
      return /(실패|중단|피벗|재시작|못하면|아니면|fail|stop|pivot|no reply|응답 없음)/i.test(value);
    case "tradeoff":
      return /(tradeoff|트레이드오프|대신|보다|우선|포기|선택|희생|감수)/i.test(value);
    case "rejected_option":
      return /(하지 않|안 하|포기|버리|제외|나중|금지|non-goal|refuse|skip|defer)/i.test(value);
    case "trigger":
      return /(때|상황|경우|if|when|trigger|트리거|결정|마다)/i.test(value);
    case "violation_example":
      return /(위반|예시|하면 안|금지|나쁜|잘못|반례|violate|bad|wrong)/i.test(value);
    case "user_workflow":
      return /(workflow|흐름|여정|사용자|단계|먼저|다음|클릭|입력|열고|고르고|저장|journey|step)/i.test(value);
    case "mvp_wedge":
      return /(mvp|wedge|작은|최소|첫 버전|v0|이번 주|one thing|smallest)/i.test(value);
    case "non_goal":
      return /(non-goal|만들지 않을|하지 않을|하지 않|않을 것|안 하|포기할|제외할|제외|나중|범위 밖|스코프 밖|defer|skip|out of scope)/i.test(value);
    case "observable_success":
      return /(성공|관찰|측정|완료|보이면|기준|signal|success|observe|measure)/i.test(value);
    case "core_risk":
      return /(리스크|위험|가정|틀리|실패|불확실|risk|assumption|fail|wrong)/i.test(value);
    default:
      return false;
  }
}

function normalizeRubricText(text) {
  return String(text || "")
    .replace(/[`*_#>\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasNumber(text) {
  return /[0-9０-９]/.test(String(text || ""));
}

export function recordIddStructuredResponse(state, {
  doc,
  provider = "codex",
  responseText = "",
  responseDescription = "",
  signalId = null,
  signalLabel = null,
} = {}) {
  const normalized = normalizeIddSetupState(state);
  const targetDoc = doc || nextIddFoundationDoc(normalized) || IDD_FOUNDATION_DOCS[0];
  const now = new Date().toISOString();
  const transcriptEntry = {
    id: `${targetDoc.type}-${normalized.transcript.length + 1}`,
    docType: targetDoc.type,
    provider,
    responseText: String(responseText || "").trim(),
    responseDescription: String(responseDescription || "").trim(),
    signalId: signalId ? String(signalId) : null,
    signalLabel: signalLabel ? String(signalLabel) : null,
    createdAt: now,
  };
  const transcript = [...normalized.transcript, transcriptEntry];
  const drafts = {
    ...normalized.drafts,
    [targetDoc.type]: buildIddDraftDocument(targetDoc, transcriptEntry, {
      transcript,
      provider,
    }),
  };
  const rubric = calculateIddAmbiguityRubric({ ...normalized, transcript, drafts });
  const targetDocRubric = rubric.docs.find((entry) => entry.type === targetDoc.type);
  const targetDocBlocked = targetDocRubric ? targetDocRubric.blocked : true;
  const nextDoc = targetDocBlocked
    ? targetDoc
    : IDD_FOUNDATION_DOCS.find((candidate) => !drafts[candidate.type]?.trim());
  return normalizeIddSetupState({
    ...normalized,
    status: nextDoc || rubric.blocked ? "interviewing" : "preview_ready",
    currentDocType: nextDoc?.type || targetDoc.type,
    transcript,
    drafts,
    ambiguityScore: rubric.score,
    ambiguityRubric: rubric,
    unresolvedAssumptions: rubric.unresolvedAssumptions,
    lastProvider: provider,
    providerRecovery: null,
    updatedAt: now,
  });
}

export function setIddProviderRecovery(state, { provider = "codex", message = "" } = {}) {
  const normalized = normalizeIddSetupState(state);
  return normalizeIddSetupState({
    ...normalized,
    status: "provider_recovery",
    providerRecovery: {
      provider,
      message: String(message || `${provider} 인증이 필요합니다.`),
      actionId: `${provider}_login`,
    },
    updatedAt: new Date().toISOString(),
  });
}

export function setIddSetupError(state, { provider = "codex", docType = null, message = "" } = {}) {
  const normalized = normalizeIddSetupState(state);
  return normalizeIddSetupState({
    ...normalized,
    status: "error",
    lastProvider: provider,
    providerRecovery: null,
    setupError: {
      provider,
      docType,
      message: String(message || "초기 설정 질문 카드 준비가 중단됐습니다. 다시 시도해 주세요."),
      recoverable: true,
    },
    updatedAt: new Date().toISOString(),
  });
}

export async function approveIddSetupDocuments(workspaceRoot, state, { fsImpl = fs } = {}) {
  const normalized = normalizeIddSetupState(state);
  const missing = IDD_FOUNDATION_DOCS.filter((doc) => !normalized.drafts?.[doc.type]?.trim());
  if (missing.length) {
    throw new Error(`IDD preview is incomplete: ${missing.map((doc) => doc.title).join(", ")}`);
  }
  if (normalized.ambiguityScore > IDD_AMBIGUITY_THRESHOLD) {
    throw new Error(`IDD ambiguity is too high: ${normalized.ambiguityScore}% > ${IDD_AMBIGUITY_THRESHOLD}%`);
  }
  const root = path.resolve(workspaceRoot || ".");
  const approvedDocPaths = [];
  for (const doc of IDD_FOUNDATION_DOCS) {
    const target = path.join(root, doc.canonicalPath);
    await fsImpl.mkdir(path.dirname(target), { recursive: true });
    await fsImpl.writeFile(target, normalized.drafts[doc.type], "utf8");
    approvedDocPaths.push(doc.canonicalPath);
  }
  const next = normalizeIddSetupState({
    ...normalized,
    status: "approved",
    approvedAt: new Date().toISOString(),
    approvedDocPaths,
    ambiguityScore: normalized.ambiguityScore,
    ambiguityRubric: normalized.ambiguityRubric,
    unresolvedAssumptions: normalized.unresolvedAssumptions.slice(0, 3),
  });
  return persistIddSetupState(workspaceRoot, next, { fsImpl });
}

export function buildIddApprovalSummary(state) {
  const normalized = normalizeIddSetupState(state);
  const paths = IDD_FOUNDATION_DOCS.map((doc) => doc.canonicalPath).join(", ");
  return [
    "초기 설정이 승인되었습니다.",
    "",
    `작성된 문서: ${paths}`,
    `Ambiguity: ${normalized.ambiguityScore}%`,
    normalized.unresolvedAssumptions.length
      ? `남은 가정: ${normalized.unresolvedAssumptions.slice(0, 3).join(" / ")}`
      : "남은 가정: 없음",
    "",
    "이제 Day 1 Mission 후보를 생성할 수 있습니다.",
  ].join("\n");
}

function buildIddDocPreviews(state) {
  const normalized = normalizeIddSetupState(state);
  return IDD_FOUNDATION_DOCS.map((doc) => ({
    type: doc.type,
    title: doc.title,
    path: doc.canonicalPath,
    status: normalized.docWriteStatuses?.[doc.type]?.status
      || (normalized.status === "approved" && normalized.approvedDocPaths?.includes(doc.canonicalPath) ? "approved" : null)
      || (normalized.drafts?.[doc.type]?.trim() ? "drafted" : "pending"),
    content: normalized.drafts?.[doc.type] || "",
  }));
}

export function day1HandoffDocByType(type) {
  return IDD_FOUNDATION_DOCS.find((doc) => doc.type === String(type || ""))
    || null;
}

const DAY1_HANDOFF_PLACEHOLDER_PATTERNS = [
  /첫\s*고객\s*후보/i,
  /검증할\s*문제/i,
  /이번\s*주\s*확인할\s*행동/i,
  /Day\s*1에서\s*고른\s*좁은\s*첫\s*고객군/i,
  /현재\s*대안과\s*압박\s*비용이\s*아직\s*약한\s*가정/i,
  /이번\s*주\s*관찰\s*가능한\s*완료\s*행동/i,
];

const DAY1_HANDOFF_INTERNAL_PATTERNS = [
  /Agentic30/i,
  /\bFoundation\b/i,
  /GOAL\/ICP\/VALUES\/SPEC\s*문서/i,
  /문서\s*저장/i,
  /새\s*AI\s*실행/i,
  /Day\s*1/i,
];

export function buildDay1HandoffResponseText(doc, { day1Handoff = {} } = {}) {
  return buildDay1HandoffUserFacingDocument(doc, { day1Handoff });
}

function buildDay1HandoffUserFacingDocument(doc, { day1Handoff = {} } = {}) {
  const facts = normalizeDay1HandoffFacts(day1Handoff);
  switch (doc?.type) {
    case "goal":
      return renderGoalHandoffDocument(facts);
    case "icp":
      return renderIcpHandoffDocument(facts);
    case "values":
      return renderValuesHandoffDocument(facts);
    case "spec":
      return renderSpecHandoffDocument(facts);
    default:
      return [
        `# ${doc?.title || "Document"}`,
        "",
        handoffBullet("목표", facts.northStarGoal),
        handoffBullet("고객", facts.targetUser),
        handoffBullet("문제", facts.problem),
        handoffBullet("다음 행동", facts.nextAction),
      ].join("\n");
  }
}

function renderGoalHandoffDocument(facts) {
  return compactMarkdown([
    "# GOAL",
    "",
    "## 30일 목표",
    handoffBullet(null, facts.northStarGoal),
    "",
    "## 현재 측정 계약",
    handoffBullet("증명할 것", facts.weeklyProof || facts.entryPoint),
    handoffBullet("판단 지표", facts.metric || facts.weeklyProof),
    handoffBullet("기준값/기한", facts.threshold),
    handoffBullet("실패 조건", facts.failureCondition),
    handoffBullet("활성 행동", facts.activationAction),
    "",
    "## 다음 행동",
    handoffBullet(null, facts.nextAction || facts.entryPoint),
    "",
    "## 증거부채",
    ...handoffListLines(facts.evidenceDebt, { empty: ["- 확인 필요"] }),
    "",
    renderHandoffEvidenceSections(facts),
  ]);
}

function renderIcpHandoffDocument(facts) {
  return compactMarkdown([
    "# ICP",
    "",
    "## 행동-상황 고객 후보",
    handoffBullet(null, facts.targetUser),
    "",
    "## 현재 대안",
    handoffBullet(null, facts.currentAlternative),
    handoffBullet("압박 비용", facts.pressureCost),
    "",
    "## 문제와 시급성",
    handoffBullet(null, facts.problem),
    "",
    "## 이번 주 닿을 방법",
    handoffBullet(null, facts.firstReach || facts.nextAction || facts.weeklyProof),
    "",
    "## 제외할 고객 / Anti-ICP",
    ...handoffListLines(facts.nonGoals),
    "",
    "## 남은 고객 증거부채",
    ...handoffListLines(facts.evidenceDebt, { empty: ["- 확인 필요"] }),
    "",
    renderHandoffEvidenceSections(facts),
  ]);
}

function renderSpecHandoffDocument(facts) {
  const flow = [
    facts.targetUser ? `대상 사용자: ${facts.targetUser}` : "",
    facts.entryPoint ? `첫 진입점: ${facts.entryPoint}` : "",
    facts.activationAction ? `핵심 활성 행동: ${facts.activationAction}` : "",
    facts.nextAction ? `검증 방법: ${facts.nextAction}` : "",
  ].filter(Boolean);
  return compactMarkdown([
    "# SPEC",
    "",
    "## 문제",
    handoffBullet(null, facts.problem),
    "",
    "## 가장 작은 유료 진입점",
    handoffBullet(null, facts.entryPoint),
    "",
    "## Core Loop",
    ...(flow.length ? flow.map((line, index) => `${index + 1}. ${line}`) : ["- 확인 필요"]),
    "",
    "## MVP 범위",
    handoffBullet("이번 주 포함", facts.entryPoint || facts.activationAction || facts.nextAction),
    handoffBullet("성공 신호", facts.weeklyProof || facts.nextAction),
    "",
    "## Out of Scope",
    ...handoffListLines(facts.nonGoals),
    "",
    "## 핵심 리스크",
    handoffBullet(null, facts.assumptions[0]),
    "",
    "## 근거 링크",
    ...handoffListLines(facts.sourceQuotes, { empty: ["- 확인 필요"] }),
    "",
    renderHandoffEvidenceSections(facts),
  ]);
}

function renderValuesHandoffDocument(facts) {
  const decisionAnchor = facts.nextAction || facts.weeklyProof || facts.entryPoint;
  const principle = decisionAnchor
    ? `이번 주 결정은 "${decisionAnchor}"에서 나온 사용자 행동 증거를 우선한다.`
    : "이번 주 결정은 사용자 행동 증거를 우선한다.";
  const trigger = facts.weeklyProof
    ? `"${facts.weeklyProof}"가 확인되기 전에 범위를 늘리고 싶을 때 적용한다.`
    : "검증 증거 없이 범위를 늘리고 싶을 때 적용한다.";
  return compactMarkdown([
    "# VALUES",
    "",
    "## 안정 제품 가치",
    "- 누적되는 압박: 매 세션은 지난 증거부채를 숨기지 않고 다음 고객/시장 질문으로 이어진다.",
    "- 행동 증거 우선: 말, 관심, 기능 완성보다 실명 고객의 현재 대안, 돈, 시간, 완료 행동을 먼저 본다.",
    `- ${principle}`,
    "",
    "## 포기할 선택",
    ...handoffListLines(facts.nonGoals),
    "",
    "## 적용 상황",
    `- ${trigger}`,
    "",
    "## 충돌 로그",
    ...handoffListLines(facts.evidenceDebt, { empty: ["- 아직 원칙을 바꿀 만큼의 충돌 증거는 없음"] }),
    "",
    "## 위반 예시",
    "- 인터뷰 답변이나 사용 행동 없이 고객, 기능, 진입점을 넓히는 것.",
    "",
    renderHandoffEvidenceSections(facts),
  ]);
}

function renderHandoffEvidenceSections(facts) {
  return compactMarkdown([
    facts.sourceQuotes.length ? "## 근거 문구" : "",
    ...handoffListLines(facts.sourceQuotes, { empty: [] }),
    facts.assumptions.length ? "" : "",
    facts.assumptions.length ? "## 남은 가정" : "",
    ...handoffListLines(facts.assumptions, { empty: [] }),
  ]);
}

function handoffBullet(label, value) {
  const text = cleanHandoffField(value) || "확인 필요";
  return label ? `- ${label}: ${text}` : `- ${text}`;
}

function handoffListLines(values, { empty = ["- 확인 필요"] } = {}) {
  const items = cleanHandoffList(values);
  return items.length ? items.map((item) => `- ${item}`) : empty;
}

function compactMarkdown(lines) {
  return lines
    .flatMap((line) => String(line || "").split("\n"))
    .reduce((acc, line) => {
      const previous = acc[acc.length - 1];
      if (line === "" && previous === "") return acc;
      acc.push(line);
      return acc;
    }, [])
    .join("\n")
    .trim();
}

export async function writeAllDay1HandoffDocuments(workspaceRoot, state, {
  day1Handoff = {},
  provider = "codex",
  fsImpl = fs,
  onProgress = null,
  runEvidenceJudge = false,
  judgeOfficeHoursDocs = judgeOfficeHoursEvidenceDocuments,
} = {}) {
  let nextState = normalizeIddSetupState(state);
  const evidenceState = await buildOfficeHoursEvidenceState({
    workspaceRoot,
    day1Handoff,
    fsImpl,
  });
  const hasEvidence = hasOfficeHoursReducerEvidence(evidenceState);
  const mergedHandoff = hasEvidence
    ? mergeDay1HandoffWithEvidence(day1Handoff, evidenceState)
    : day1Handoff;
  let judgeResult = null;
  // GATE-01: fail-closed. When the judge is requested we always run it, even
  // with no reducer evidence — the judge's hard-evidence gate turns "no
  // evidence" into a blocked save instead of silently writing the docs. The
  // previous `&& hasEvidence` let new/Day0 users bypass the judge entirely.
  if (runEvidenceJudge) {
    const documents = Object.fromEntries(DAY1_HANDOFF_DOC_TYPES.map((type) => {
      const doc = day1HandoffDocByType(type);
      return [type, doc ? buildDay1HandoffResponseText(doc, { day1Handoff: mergedHandoff }) : ""];
    }));
    judgeResult = await judgeOfficeHoursDocs({
      provider,
      workspaceRoot,
      evidenceState,
      documents,
    });
    evidenceState.judge = judgeResult;
    if (!judgeResult?.passed) {
      await writeOfficeHoursEvidenceDebtReport(workspaceRoot, evidenceState, {
        judgeResult,
        fsImpl,
      }).catch(() => null);
      const failedState = setIddSetupError(nextState, {
        provider,
        docType: DAY1_HANDOFF_DOC_TYPES[0],
        message: `Office Hours 문서 judge가 ${judgeResult?.score ?? 0}/10으로 저장을 보류했습니다. 기준은 ${OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE}/10입니다.`,
      });
      return {
        state: failedState,
        written: [],
        blocked: true,
        evidenceState,
        judgeResult,
        evidenceDebtCard: renderOfficeHoursEvidenceDebtCard(evidenceState),
      };
    }
  }
  const written = [];
  for (const type of DAY1_HANDOFF_DOC_TYPES) {
    const doc = day1HandoffDocByType(type);
    if (!doc) continue;
    if (isDay1HandoffDocWritten(nextState, type)) {
      written.push(doc);
      await onProgress?.({ stage: "skipped", doc, state: nextState });
      continue;
    }
    nextState = recordIddStructuredResponse(nextState, {
      doc,
      provider,
      responseText: buildDay1HandoffResponseText(doc, { day1Handoff: mergedHandoff }),
    });
    await onProgress?.({ stage: "recorded", doc, state: nextState });
    nextState = await writeDay1HandoffDocument(workspaceRoot, nextState, doc, {
      day1Handoff: mergedHandoff,
      evidenceState: hasEvidence ? evidenceState : null,
      judgeResult,
      fsImpl,
    });
    written.push(doc);
    await onProgress?.({ stage: "written", doc, state: nextState });
  }
  return {
    state: normalizeIddSetupState(nextState),
    written,
    blocked: false,
    evidenceState: hasEvidence ? evidenceState : null,
    judgeResult,
    evidenceDebtCard: hasEvidence ? renderOfficeHoursEvidenceDebtCard(evidenceState) : "",
  };
}

function hasOfficeHoursReducerEvidence(evidenceState = {}) {
  // daily_digest is a derived aggregate, not a direct user signal. Requiring a
  // real turn or commitment keeps "merge evidence into the handoff" honest;
  // digest-only sessions fall through to the fail-closed judge gate instead.
  return (Array.isArray(evidenceState.references) ? evidenceState.references : [])
    .some((ref) => ["office_hours_turn", "office_hours_commitment"].includes(ref?.sourceType));
}

export function isDay1HandoffDocWritten(state, type) {
  const normalized = normalizeIddSetupState(state);
  const status = normalized.docWriteStatuses?.[type]?.status;
  return ["written", "written_with_assumptions", "approved"].includes(status);
}

export function isDay1HandoffComplete(state) {
  const normalized = normalizeIddSetupState(state);
  return DAY1_HANDOFF_DOC_TYPES.every((type) => isDay1HandoffDocWritten(normalized, type));
}

export function nextDay1HandoffDocType(state) {
  const normalized = normalizeIddSetupState(state);
  return DAY1_HANDOFF_DOC_TYPES.find((type) => !isDay1HandoffDocWritten(normalized, type)) || null;
}

export function canStartDay1HandoffDoc(state, type) {
  const requested = String(type || "");
  const index = DAY1_HANDOFF_DOC_TYPES.indexOf(requested);
  if (index < 0) return false;
  const normalized = normalizeIddSetupState(state);
  return DAY1_HANDOFF_DOC_TYPES
    .slice(0, index)
    .every((candidate) => isDay1HandoffDocWritten(normalized, candidate));
}

export function buildDay1HandoffDocumentContent(doc, draft, {
  day1Handoff = {},
  unresolvedAssumptions = [],
  writtenAt = new Date().toISOString(),
  status = "written",
} = {}) {
  const pathLabel = doc?.canonicalPath || "";
  const userFacingDraft = buildDay1HandoffUserFacingDocument(doc, { day1Handoff });
  const assumptionLines = unresolvedAssumptions.length
    ? [`<!-- assumptions: ${unresolvedAssumptions.join(" / ")} -->`]
    : [];
  return [
    DAY1_HANDOFF_MARKER_START,
    `<!-- generated_by: office-hours; target: ${pathLabel}; written: ${writtenAt}; status: ${status} -->`,
    ...assumptionLines,
    "",
    cleanHandoffField(userFacingDraft) || cleanHandoffField(draft) || `# ${doc?.title || "Document"}\n\n확인 필요`,
    DAY1_HANDOFF_MARKER_END,
    "",
  ].filter((line) => line !== null).join("\n");
}

export function mergeDay1HandoffBlock(existingContent, handoffBlock, doc) {
  const rawBlock = String(handoffBlock || "").trimEnd();
  const existing = String(existingContent || "");
  const markerPattern = new RegExp(
    `${escapeRegExp(DAY1_HANDOFF_MARKER_START)}[\\s\\S]*?${escapeRegExp(DAY1_HANDOFF_MARKER_END)}\\n?`,
    "m",
  );
  const blockWithHeading = `${rawBlock}\n`;
  if (!existing.trim() || isMarkdownTitleOnlyStub(existing)) {
    return blockWithHeading;
  }
  const existingWithoutManagedBlock = existing.replace(markerPattern, "").trim();
  const existingTitle = firstMarkdownH1(existingWithoutManagedBlock);
  const block = `${stripMatchingHandoffBlockH1(rawBlock, existingTitle).trimEnd()}\n`;
  if (markerPattern.test(existing)) {
    return existing.replace(markerPattern, block);
  }
  if (existing.trim()) {
    return `${existing.replace(/\s*$/u, "\n\n")}${block}`;
  }
  return blockWithHeading;
}

function isMarkdownTitleOnlyStub(content) {
  const meaningfulLines = String(content || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return meaningfulLines.length === 1 && /^#\s+\S/.test(meaningfulLines[0]);
}

function firstMarkdownH1(content) {
  const match = String(content || "").match(/^#\s+(.+?)\s*$/m);
  return match ? normalizeMarkdownHeadingText(match[1]) : "";
}

function stripMatchingHandoffBlockH1(block, existingTitle) {
  if (!existingTitle) return String(block || "");
  const lines = String(block || "").split("\n");
  const headingIndex = lines.findIndex((line) => {
    const match = line.match(/^#\s+(.+?)\s*$/);
    return match && normalizeMarkdownHeadingText(match[1]) === existingTitle;
  });
  if (headingIndex < 0) return String(block || "");
  const next = [...lines];
  next.splice(headingIndex, 1);
  if (next[headingIndex] === "") {
    next.splice(headingIndex, 1);
  }
  return next.join("\n");
}

function normalizeMarkdownHeadingText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export async function writeDay1HandoffDocument(workspaceRoot, state, doc, {
  day1Handoff = {},
  evidenceState = null,
  judgeResult = null,
  fsImpl = fs,
} = {}) {
  const normalized = normalizeIddSetupState(state);
  const targetDoc = doc || day1HandoffDocByType(normalized.currentDocType);
  if (!targetDoc?.type) {
    throw new Error("Day 1 handoff document type is required.");
  }
  const draft = normalized.drafts?.[targetDoc.type] || "";
  const docRubric = normalized.ambiguityRubric?.docs?.find((entry) => entry.type === targetDoc.type);
  const userFacingDraft = buildDay1HandoffUserFacingDocument(targetDoc, { day1Handoff });
  const handoffFacts = normalizeDay1HandoffFacts(day1Handoff);
  const qualityIssues = day1HandoffDocumentQualityIssues(targetDoc, userFacingDraft, handoffFacts);
  const unresolvedAssumptions = uniqueStrings([
    ...((docRubric?.missingSignals?.length)
    ? docRubric.missingSignals.map((signal) => signal.label)
    : []),
    ...handoffFacts.assumptions,
    ...qualityIssues,
  ]);
  const status = unresolvedAssumptions.length ? "written_with_assumptions" : "written";
  const writtenAt = new Date().toISOString();
  const root = path.resolve(workspaceRoot || ".");
  const target = path.join(root, targetDoc.canonicalPath);
  await fsImpl.mkdir(path.dirname(target), { recursive: true });
  let existing = "";
  try {
    existing = await fsImpl.readFile(target, "utf8");
  } catch {
    existing = "";
  }
  const block = buildDay1HandoffDocumentContent(targetDoc, draft, {
    day1Handoff,
    unresolvedAssumptions,
    writtenAt,
    status,
  });
  await fsImpl.writeFile(target, mergeDay1HandoffBlock(existing, block, targetDoc), "utf8");
  const evidenceSidecar = evidenceState
    ? await writeOfficeHoursEvidenceSidecar(workspaceRoot, targetDoc, evidenceState, {
        judgeResult,
        fsImpl,
      })
    : null;

  const docWriteStatuses = {
    ...normalized.docWriteStatuses,
    [targetDoc.type]: {
      type: targetDoc.type,
      path: targetDoc.canonicalPath,
      status,
      writtenAt,
      unresolvedAssumptions,
      ...(evidenceSidecar ? { evidencePath: evidenceSidecarPath(targetDoc.canonicalPath) } : {}),
      ...(judgeResult ? { judgeScore: judgeResult.score ?? null, judgeStatus: judgeResult.status || null } : {}),
    },
  };
  const complete = DAY1_HANDOFF_DOC_TYPES.every((type) =>
    ["written", "written_with_assumptions", "approved"].includes(docWriteStatuses[type]?.status),
  );
  const next = normalizeIddSetupState({
    ...normalized,
    drafts: {
      ...normalized.drafts,
      [targetDoc.type]: userFacingDraft,
    },
    status: complete ? "approved" : "interviewing",
    currentDocType: complete ? targetDoc.type : (nextDay1HandoffDocType({ ...normalized, docWriteStatuses }) || targetDoc.type),
    docWriteStatuses,
    approvedAt: complete ? writtenAt : normalized.approvedAt,
    approvedDocPaths: complete
      ? DAY1_HANDOFF_DOC_TYPES.map((type) => requiredDocByType(type)?.canonicalPath).filter(Boolean)
      : normalized.approvedDocPaths,
  });
  return persistIddSetupState(workspaceRoot, next, { fsImpl });
}

function cleanHandoffField(value) {
  if (Array.isArray(value)) {
    return cleanHandoffList(value).join(", ");
  }
  const text = String(value || "").trim();
  return containsDay1HandoffPlaceholder(text) ? "" : text;
}

function cleanHandoffList(value) {
  const rawItems = Array.isArray(value)
    ? value
    : (typeof value === "string" && value.includes("\n") ? value.split(/\n+/) : (value ? [value] : []));
  return rawItems
    .map((item) => cleanHandoffField(item))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeDay1HandoffFacts(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const nestedFacts = source.facts && typeof source.facts === "object" && !Array.isArray(source.facts)
    ? source.facts
    : {};
  const merged = { ...source, ...nestedFacts };
  const first = (...keys) => {
    for (const key of keys) {
      const candidate = cleanHandoffField(merged[key]);
      if (candidate) return candidate;
    }
    return "";
  };
  return {
    northStarGoal: first("northStarGoal", "north_star_goal", "goal"),
    weeklyProof: first("weeklyProof", "weekly_proof", "proof", "validationAction", "validation_action"),
    targetUser: first("targetUser", "target_user", "customer", "icp"),
    problem: first("problem", "pain"),
    currentAlternative: first("currentAlternative", "current_alternative", "statusQuo", "status_quo"),
    entryPoint: first("entryPoint", "entry_point", "wedge"),
    nextAction: first("nextAction", "next_action", "outcome"),
    metric: first("metric"),
    threshold: first("threshold"),
    failureCondition: first("failureCondition", "failure_condition"),
    pressureCost: first("pressureCost", "pressure_cost"),
    activationAction: first("activationAction", "activation_action"),
    firstReach: first("firstReach", "first_reach", "channel", "firstChannel", "first_channel"),
    nonGoals: cleanHandoffList(merged.nonGoals ?? merged.non_goals),
    assumptions: cleanHandoffList(merged.assumptions),
    sourceQuotes: cleanHandoffList(merged.sourceQuotes ?? merged.source_quotes),
    evidenceDebt: cleanHandoffList(merged.evidenceDebt ?? merged.evidence_debt),
    nextQuestion: first("nextQuestion", "next_question"),
    markdown: cleanHandoffField(merged.markdown),
  };
}

function day1HandoffDocumentQualityIssues(doc, content, facts) {
  const issues = [];
  const text = String(content || "");
  const evidenceEnriched = day1HandoffHasReducerEvidence(facts);
  if (containsDay1HandoffPlaceholder(text)) {
    issues.push("문서에 placeholder가 남아 있습니다.");
  }
  if (day1HandoffFactCount(facts) === 0) {
    issues.push("Office Hours 근거가 없습니다.");
  }
  if (!day1HandoffLooksLikeAgentic30Product(facts) && ["spec", "values"].includes(doc?.type)) {
    if (DAY1_HANDOFF_INTERNAL_PATTERNS.some((pattern) => pattern.test(text))) {
      issues.push("문서에 Agentic30 내부 구현 맥락이 섞여 있습니다.");
    }
  }
  if (doc?.type === "goal" && !facts.northStarGoal && !facts.weeklyProof) {
    issues.push("GOAL: 목표 또는 이번 주 검증 기준 확인 필요");
  }
  if (doc?.type === "goal" && evidenceEnriched) {
    if (!facts.metric) issues.push("GOAL: 판단 지표 확인 필요");
    if (!facts.threshold) issues.push("GOAL: 기준값/기한 확인 필요");
    if (!facts.failureCondition) issues.push("GOAL: 실패 조건 확인 필요");
  }
  if (doc?.type === "icp") {
    if (!facts.targetUser) issues.push("고객 후보 확인 필요");
    if (!facts.currentAlternative) issues.push("현재 대안 확인 필요");
    if (evidenceEnriched && !facts.pressureCost) issues.push("압박 비용 확인 필요");
  }
  if (doc?.type === "spec") {
    if (!facts.problem) issues.push("SPEC: 문제 확인 필요");
    if (!facts.entryPoint) issues.push("SPEC: 가장 작은 진입점 확인 필요");
    if (evidenceEnriched && !facts.activationAction && !facts.nextAction) issues.push("SPEC: 핵심 흐름 확인 필요");
  }
  if (doc?.type === "values" && facts.nonGoals.length === 0) {
    issues.push("VALUES: 포기할 선택 확인 필요");
  }
  return uniqueStrings(issues);
}

function day1HandoffHasReducerEvidence(facts) {
  return Boolean(
    facts.activationAction
    || facts.pressureCost
    || facts.firstReach
    || facts.nextQuestion
    || (facts.evidenceDebt || []).length
    || (facts.sourceQuotes || []).some((item) => /고객 후보|현재 대안|유료|외부 시장 신호|첫 가치/.test(item)),
  );
}

function day1HandoffFactCount(facts) {
  return [
    facts.northStarGoal,
    facts.weeklyProof,
    facts.targetUser,
    facts.problem,
    facts.currentAlternative,
    facts.entryPoint,
    facts.nextAction,
    facts.metric,
    facts.threshold,
    facts.failureCondition,
    facts.pressureCost,
    facts.activationAction,
    ...(facts.sourceQuotes || []),
  ].filter((value) => cleanHandoffField(value)).length;
}

function day1HandoffLooksLikeAgentic30Product(facts) {
  const text = [
    facts.northStarGoal,
    facts.weeklyProof,
    facts.targetUser,
    facts.problem,
    facts.currentAlternative,
    facts.entryPoint,
    facts.nextAction,
    facts.metric,
    facts.threshold,
    facts.failureCondition,
    facts.pressureCost,
    facts.activationAction,
    facts.markdown,
    ...(facts.sourceQuotes || []),
  ].filter(Boolean).join("\n");
  return /Agentic30/i.test(text);
}

function containsDay1HandoffPlaceholder(value) {
  const text = String(value || "").trim();
  return Boolean(text) && DAY1_HANDOFF_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildIddDraftDocument(doc, transcriptEntry, { transcript = [], provider = "codex" } = {}) {
  const answer = transcriptEntry.responseText || "(응답 없음)";
  const pressurePass = pressurePassFor(doc);
  const title = doc.title;
  const allDocAnswers = transcript
    .filter((entry) => entry.docType === doc?.type)
    .map((entry) => entry.responseText)
    .filter(Boolean);
  const evidence = allDocAnswers.length ? allDocAnswers.join("\n") : answer;
  const decision = evidence.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 4).join(" / ") || answer;
  const rubric = calculateIddAmbiguityRubric({
    transcript,
    drafts: {
      [doc.type]: evidence,
    },
  });
  const docRubric = rubric.docs.find((entry) => entry.type === doc.type);
  return [
    `# ${title}`,
    "",
    `> Agentic30 초기 설정에서 생성됨. AI 실행 경로: ${provider}.`,
    "",
    "## Core Decision",
    decision,
    "",
    "## Evidence From Interview",
    evidence,
    "",
    "## Rubric Signals",
    ...(docRubric?.passedSignals?.length
      ? docRubric.passedSignals.map((signal) => `- Confirmed: ${signal.label}`)
      : ["- Confirmed: none yet"]),
    ...(docRubric?.missingSignals?.length
      ? docRubric.missingSignals.map((signal) => `- Missing: ${signal.label}`)
      : ["- Missing: none"]),
    "",
    "## Non-Goals",
    "- Do not expand scope before the first narrow validation signal is observed.",
    "- Do not treat vague interest as demand.",
    "- Do not add platform features that do not support this week's decision.",
    "",
    "## Decision Boundaries",
    "- If the next action does not create user evidence this week, defer it.",
    "- If the scope cannot be explained in one sentence, narrow it before building.",
    "- If the priority choice is unclear, record the rejected option and the evidence needed to revisit it.",
    "",
    "## Pressure-Pass Follow-Up",
    pressurePass,
    "",
    "## Open Assumptions",
    ...(docRubric?.missingSignals?.length
      ? docRubric.missingSignals.map((item) => `- ${item.label}`)
      : openAssumptionsFor(doc, transcript).map((item) => `- ${item}`)),
    "",
  ].join("\n");
}

function pressurePassFor(doc) {
  switch (doc?.type) {
    case "icp":
      return "Name one reachable person or account that fits this customer candidate. If none exists, the customer candidate is still too broad.";
    case "goal":
      return "Cut the goal to one weekly validation target. If it cannot be measured this week, it is not the current goal.";
    case "values":
      return "Pick the rule that will hurt most when applied. If no priority choice hurts, the value is decorative.";
    case "spec":
      return "Remove one feature from the first version. If nothing can be removed, the spec is still a wishlist.";
    default:
      return "State the riskiest assumption in one sentence and the smallest test that could disprove it.";
  }
}

function openAssumptionsFor(doc, transcript = []) {
  const base = {
    icp: [
      "The selected customer candidate is reachable this week.",
      "The current alternative is painful enough to discuss or pay for.",
    ],
    goal: [
      "The chosen metric reflects actual product progress.",
      "The weekly milestone can be completed without hidden dependencies.",
    ],
    values: [
      "The stated values will change a real product decision.",
      "The non-goals are strict enough to prevent scope drift.",
    ],
    spec: [
      "The first-version scope solves the core problem without extra platform work.",
      "The success criteria can be observed by the target user.",
    ],
  };
  const count = transcript.filter((entry) => entry.docType === doc?.type).length;
  return (base[doc?.type] || ["The document still needs a sharper evidence source."])
    .slice(0, Math.max(1, 3 - count));
}

function unresolvedAssumptionsForDrafts(drafts = {}) {
  const missing = IDD_FOUNDATION_DOCS.filter((doc) => !drafts?.[doc.type]?.trim());
  if (missing.length) {
    return missing.map((doc) => `${doc.title} decision is not approved yet.`);
  }
  return [
    "Validate the customer candidate with one named reachable user.",
    "Confirm the SPEC scope survives one real user flow.",
  ];
}

export function buildIddDocumentPrompt(doc, {
  provider = "codex",
  workspaceRoot = "",
  queue = [],
  specialistInjection = "",
} = {}) {
  const toolInstruction = provider === "claude"
    ? "사용자의 결정이나 누락 정보가 필요하면 반드시 AskUserQuestionTool(AskUserQuestion)을 사용하세요."
    : `사용자의 결정이나 누락 정보가 필요하면 반드시 ${CODEX_STRUCTURED_INPUT_TOOL} 도구 연결을 사용하세요. 이 구조화 입력은 host UI에서 request_user_input 카드로 표시됩니다.`;
  const structuredToolName = provider === "claude"
    ? "AskUserQuestionTool(AskUserQuestion)"
    : CODEX_STRUCTURED_INPUT_TOOL;
  const queueLine = queue.length
    ? `현재 IDD 큐: ${queue.map((item) => item.title).join(" → ")}`
    : `현재 IDD 문서: ${doc.title}`;
  const specialistBlock = specialistInjection
    ? [
        "",
        "Auto-routed specialist 모드:",
        String(specialistInjection).trim(),
        "",
      ]
    : [];

  return [
    `IDD 문서 인터뷰를 시작합니다: ${doc.title}`,
    "",
    "역할: Interview Driven Development 문서화 에이전트입니다.",
    `대상 파일: ${doc.canonicalPath}`,
    `워크스페이스: ${workspaceRoot}`,
    queueLine,
    ...specialistBlock,
    "절대 규칙:",
    `- ${toolInstruction}`,
    "- 이 IDD 세션은 `/plan` 모드처럼 진행합니다. 인터뷰 질문은 사용자가 UI에서 클릭/입력할 수 있는 구조화 입력으로 받아야 합니다.",
    `- 선택지가 있는 질문, 우선순위 질문, 예/아니오 질문, 짧은 자유 입력이 붙은 질문은 일반 prose나 번호 목록으로 쓰지 말고 반드시 ${structuredToolName} 호출로만 물으세요.`,
    `- ${structuredToolName} 호출이 필요한 상황에서 같은 내용을 prose/번호 목록으로 대신 묻지 마세요. 도구 호출 자체가 실패하면 같은 질문을 prose/번호 목록으로 대신 출력하지 말고 중단하세요.`,
    "- 도구 질문은 question/options/allowFreeText/freeTextPlaceholder/textMode를 채워 1개 질문 단위로 만드세요. 후보 options는 2-4개로 제한하고 allowFreeText=true를 둡니다. 선택지와 한 줄 근거를 동시에 요구하지 말고 선택지 또는 기타 자유 입력 중 하나로 답하게 하세요. 후보군 없이 자유입력만 묻지 마세요.",
    "- 금지 예: \"1. 반복 사용 2. 도입 준비 3. 먼저 요청함\" 같은 번호 목록을 assistant 메시지로 출력하는 것.",
    "- 예전 고정 질문 금지: title=\"고객 후보 1/4\", question=\"이번 주 바로 인터뷰할 첫 고객은 누구인가요?\", option=\"가장 절박한 하위 고객 후보\"를 그대로 쓰면 실패입니다.",
    `- 첫 질문은 반드시 관찰한 repo 사실을 포함하세요. 예: agentic30-public의 SwiftUI macOS 앱과 Node 실행 보조 앱 구조, Codex/Claude AI 연결 전환, 30일 커리큘럼, ${projectDocPath("icp")} 같은 실제 맥락 중 하나 이상.`,
    "- 이 세션에서는 이 문서 하나만 다룹니다. 다른 문서 인터뷰를 섞지 마세요.",
    "- 질문은 한 번에 하나의 고레버리지 질문으로 하세요.",
    "- 첫 질문도 host가 미리 만든 고정 질문이 아닙니다. 반드시 실행 보조 앱의 워크스페이스 도구로 프로젝트 폴더를 살펴본 뒤 프로젝트 상태에 맞춰 새로 생성하세요.",
    "- 뻔한 질문 대신 문제 정의, 핵심 가치, 타깃 사용자, 사용자 여정, 비즈니스 모델, 경쟁 환경, 기술 제약, 첫 버전 우선순위, 우려 사항, 우선순위 선택을 깊게 파고드세요.",
    "",
    "Pushback 표준 응답 (gstack /office-hours 패턴 5종):",
    "- 모호한 시장 → 구체성 강제. 사용자가 \"개발자\", \"창업자\", \"엔터프라이즈\" 같은 집합명사로 답하면 다음 question은 회사명/직함/주당 시간/구체 작업으로 좁히는 형태로 강제하세요. 예: \"그 개발자가 어떤 회사의 어떤 역할에서 주당 몇 시간을 [task]에 쓰는데? 한 명만 이름을 알려주세요.\"",
    "- 사회적 증거 → 수요 검증. \"다들 좋다고 한다\", \"대기 신청자가 있다\"는 답이 나오면 다음 question을 \"돈을 내겠다고 한 사람? 출시 시점을 물어본 사람? 프로토타입이 고장 났을 때 화낸 사람?\"으로 강제하세요. 사랑은 수요가 아닙니다.",
    "- 플랫폼 비전 → 작은 유료 진입점 도전. \"풀 플랫폼이 필요하다\"는 답이 나오면 다음 question을 \"이번 주 한 사용자가 결제할 가장 작은 한 가지가 뭐예요?\"로 좁히세요.",
    "- 성장률 통계 → 비전 검증. \"시장이 N% 성장 중\"이라는 답에는 \"같은 통계는 모든 경쟁자가 인용해요. 너의 thesis는 뭐예요?\"로 받으세요.",
    "- 정의되지 않은 용어 → 정밀도 요구. \"끊김 없는\", \"더 좋은\", \"seamless\" 같은 형용사가 나오면 \"어떤 단계에서 이탈해요? 이탈률 몇 %? 직접 관찰해본 적 있어요?\"로 측정 가능한 기준을 요구하세요.",
    "",
    "Anti-Sycophancy 규칙:",
    "- 금지 표현: \"흥미로운 접근이에요\", \"여러 방법이 있어요\", \"이렇게 할 수도 있어요\", \"그것도 괜찮을 수 있어요\", \"그렇게 생각하는 이유가 이해돼요\". 칭찬 대신 포지션 + 그 포지션을 바꿀 증거를 명시하세요.",
    "- 정중체는 유지하되 \"이 가정은 미확인이에요\", \"확인이 더 필요해요\", \"근거가 부족해요\" 같은 사실 진술은 권장됩니다. 칭찬과 사실 진술을 혼동하지 마세요.",
    "- 사용자가 구체·증거 기반 답변을 주면 무엇이 좋았는지 한 줄로 짚고 곧바로 더 어려운 후속 질문으로 넘어가세요.",
    "",
    "마무리 리뷰 체크 (문서 작성 직전 5항목):",
    "1. 남은 모순 — 답변끼리 충돌하는 부분이 있는지.",
    "2. 누락된 증거 — 결정에 근거가 없는 항목이 있는지.",
    "3. 가장 위험한 가정 — 틀리면 문서 전체가 무너지는 한 가지.",
    "4. 다음 공개 기록 글감 한 문장 — 이번 인터뷰에서 공개 글로 남길 한 문장.",
    "5. 이번 주 단 하나의 구체 행동 — 전략이 아니라 행동. \"이번 주에 [구체 인물]을 만나서 [구체 질문] 확인하기\" 같은 형태. 답변에서 도출되지 않으면 다음 질문에서 반드시 요청하세요.",
    "",
    "맞춤 인터뷰 규칙:",
    "- 질문을 만들기 전에 반드시 실행 보조 앱의 list_workspace_files, read_workspace_file, search_workspace 중 2개 이상을 사용해 현재 프로젝트의 README, `.agentic30/docs/*`, package/config, 주요 소스, 최근 git 변경을 확인하세요. 도구를 쓰지 못하면 질문하지 말고 실패 상태를 설명하세요.",
    "- 매 질문은 관찰한 프로젝트 사실에 연결되어야 합니다. 예: 실제 기능명, 화면, 사용자 흐름, 통합 서비스, 기술 제약, 최근 구현 변경, 설정된 공개 기록 문서 경로.",
    "- 사용자의 직전 답변을 다음 질문의 입력으로 삼아 선택지와 자유 입력 placeholder를 조정하세요.",
    "- 사용자가 모를 수 있는 내부 용어(ICP, ADR, BIP, MVP 등)는 질문 본문에서 먼저 쓰지 말고 쉬운 말로 풀어 쓰세요. 필요한 경우 괄호로만 짧게 보충하세요. 기준 용어표는 docs/JARGON.md입니다.",
    "- 답이 넓으면 더 좁히고 답이 추상적이면 실제 사용자/상황/증거를 요구하고 답이 모순되면 우선순위 선택을 드러내는 질문으로 이어가세요.",
    "- 어떤 프로젝트에도 그대로 붙일 수 있는 범용 질문, 체크리스트식 질문, 템플릿 문구를 금지합니다.",
    ...(doc?.type === "designSystem"
      ? [
        "- 디자인 예시를 설명해야 하면 말로만 설명하지 마세요. gstack design-shotgun을 쓸 수 있는 환경이면 실제 시안 비교로, 그렇지 않으면 ASCII ART 와이어프레임으로 보여주세요.",
        "- ASCII ART는 장식이 아니라 의사결정 도구입니다. 화면 영역, 우선순위, 클릭 대상, 응답 대기 상태를 3-6줄 안에 보여주세요.",
      ]
      : []),
    "",
    "Review-grade 질문 규칙:",
    ...(specialistInjection
      ? ["- 위에서 라우팅된 specialist 모드의 사고 방식을 그대로 한 가지 질문으로 옮기세요. 다른 specialist를 동시에 흉내내지 마세요."]
      : [
        "- gstack office-hours 벤치마크: 질문은 실제 수요, 현재 대안, 특정 사람, 가장 작은 유료 진입점을 검증해야 합니다. \"사용자\" 같은 범주 답변을 받으면 실제 이름/역할/상황/증거로 좁히세요.",
        "- gstack plan-ceo-review 벤치마크: 결정이 필요한 순간에는 최소안/이상안/대안 관점을 제시하고 추천안과 잘못 골랐을 때의 리스크를 함께 적으세요.",
        "- gstack design-review 벤치마크: 시각/문서/흐름 판단은 관찰에서 시작하세요. \"I notice\", \"I wonder\", \"What if\", \"I think ... because\" 식의 증거 기반 사고를 한국어 질문으로 녹이세요.",
        "- gstack devex-review 벤치마크: 개발자 경험은 추측하지 말고 TTHW(Time to Hello World), 단계 수, 에러 메시지의 문제/원인/해결책, 다음 행동의 명확성처럼 측정 가능한 기준으로 묻고 기록하세요.",
      ]),
    "- 모든 질문은 한 가지 결정만 다룹니다. question은 outcome 중심으로 쓰고 options는 2-4개로 제한하며 각 option description에는 구체적 결과/장점/리스크 중 하나가 보여야 합니다.",
    "- 질문에는 대안/리스크/증거/실패 모드가 드러나야 합니다. 사용자가 답하면 어떤 대안이 선택되고 어떤 리스크가 남고 어떤 증거가 문서에 들어가며 무엇이 실패로 기록되는지 알 수 있어야 합니다.",
    "- 에러나 DX 마찰을 다룰 때는 problem/cause/fix 관점으로 묻고 근거가 없으면 추측하지 말고 증거 출처를 요청하세요.",
    "- 가능하면 추천 선택지를 암시하되 사용자가 반대할 수 있게 만드세요. 추천 이유는 관찰한 프로젝트 사실이나 직전 답변에 연결되어야 합니다.",
    "- 문서 작성 전 마지막에는 리뷰 체크를 수행하세요: 남은 모순, 누락된 증거, 가장 위험한 가정, 다음 공개 기록 미션에서 공개해도 되는 한 문장 요약을 확인하세요.",
    "",
    "gstack 정렬 매트릭스:",
    "- 톤: IDD는 친절한 문서화 톤을 유지하되 gstack처럼 직접적이고 증거 중심이어야 합니다. 칭찬보다 관찰, 추측보다 근거, 애매한 답변보다 재질문을 우선하세요.",
    "- 단위: IDD의 기본 단위는 문서 하나가 아니라 질문 하나입니다. 한 질문은 한 결정만 닫아야 하며 여러 결정을 묶어 묻지 마세요.",
    "- 기준: 질문마다 어떤 기준을 검증하는지 내부적으로 태그하세요. 가능한 기준은 수요 증거, 현재 대안, 작은 유료 진입점, 범위 선택, UX 신뢰, DX 마찰, 운영 리스크, 공개 가능한 실행 증거입니다.",
    `- 사용 위치: 이 흐름은 구현 리뷰가 아니라 공개 기록 미션 전 문서 점검입니다. 답변은 곧바로 ${doc.canonicalPath}의 섹션, 결정, 리스크, 다음 공개 글감으로 변환되어야 합니다.`,
    "- 답변은 대상 문서의 섹션, 결정, 리스크, 다음 공개 기록 글감 중 하나로 연결되어야 합니다.",
    "- 실패 방지: 빈 문서, 누구에게나 붙는 템플릿 문장, 결정 없는 목록, 근거 없는 성공 기준, 조용히 빠진 리스크를 실패로 취급하세요. 발견하면 다음 질문에서 반드시 좁히거나 문서의 Open Risks에 남기세요.",
    "- 기존 문서나 README가 있으면 먼저 읽고 이미 있는 포맷/톤/섹션을 보존하세요.",
    "- 충분히 명확해질 때까지 인터뷰를 계속하고 끝나면 한국어 Markdown으로 파일을 생성/업데이트하세요.",
    "- 작성 후 변경 파일, 핵심 결정, 남은 리스크를 짧게 요약하세요.",
    "",
    "문서별 초점:",
    `- ${doc.focus}`,
    "",
    "시작 절차:",
    "1. list_workspace_files로 README/docs/package/config/source 후보를 찾으세요.",
    "2. read_workspace_file로 README 또는 가장 관련 높은 docs/source 파일을 읽고 search_workspace로 대상 문서/핵심 기능명을 확인하세요.",
    "3. question/options/helperText/freeTextPlaceholder 중 최소 하나에 관찰한 repo 사실을 넣어 구조화 질문 도구로 첫 질문을 하세요. 이 조건을 만족하지 못하는 범용 질문은 만들지 마세요.",
    "4. 인터뷰 결과를 바탕으로 대상 파일을 저장하세요.",
  ].join("\n");
}

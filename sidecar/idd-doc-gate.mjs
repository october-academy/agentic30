import fsSync from "node:fs";
import path from "node:path";
import { isBipCoachConfigured } from "./bip-coach-state.mjs";
import { normalizeWorkspaceOnboardingHypothesis } from "./onboarding-hypothesis.mjs";

export const BIP_REQUIRED_LOCAL_DOCS = [
  {
    type: "icp",
    title: "ICP",
    canonicalPath: "docs/ICP.md",
    aliases: ["docs/ICP.md"],
    focus: "ideal customer profile, anti-ICP, current alternatives, buying trigger, validation signals",
  },
  {
    type: "spec",
    title: "SPEC",
    canonicalPath: "docs/SPEC.md",
    aliases: ["docs/SPEC.md"],
    focus: "problem definition, core value, MVP scope, user journey, constraints, success metrics",
  },
  {
    type: "values",
    title: "VALUES",
    canonicalPath: "docs/VALUES.md",
    aliases: ["docs/VALUES.md", "docs/PRINCIPLES.md", "docs/PRODUCT_VALUES.md"],
    focus: "decision principles, tradeoff rules, what the project refuses to do, behavioral examples",
  },
  {
    type: "designSystem",
    title: "Design System",
    canonicalPath: "docs/DESIGN_SYSTEM.md",
    aliases: ["docs/DESIGN_SYSTEM.md", "docs/DESIGN.md", "docs/design-system.md", "docs/design-system/index.md"],
    focus: "visual principles, tokens, components, interaction patterns, accessibility, UI tradeoffs",
  },
  {
    type: "adr",
    title: "ADR",
    canonicalPath: "docs/ADR.md",
    aliases: ["docs/ADR.md", "docs/adr/README.md", "docs/architecture-decisions.md"],
    focus: "decision record format, current architecture choices, rejected alternatives, consequences",
  },
  {
    type: "goal",
    title: "GOAL",
    canonicalPath: "docs/GOAL.md",
    aliases: ["docs/GOAL.md", "docs/OKR.md"],
    focus: "mission, measurable objectives, key results, weekly milestones, operating cadence",
  },
  {
    type: "docs",
    title: "Docs",
    canonicalPath: "docs/DOCS.md",
    aliases: ["docs/DOCS.md", "docs/README.md", "docs/INDEX.md"],
    focus: "documentation map, canonical sources of truth, onboarding path, maintenance rules",
  },
  {
    type: "sheet",
    title: "Sheet",
    canonicalPath: "docs/SHEET.md",
    aliases: ["docs/SHEET.md", "docs/SHEETS.md", "docs/BIP_SHEET.md"],
    focus: "Google Sheet schema, BIP posting log columns, evidence recording workflow, quality checks",
  },
];

export const ICP_IDD_INITIAL_INPUT = {
  toolName: "request_user_input",
  title: "첫 사용자 확인",
  questions: [
    {
      header: "프로젝트 이해",
      helperText: "아직 단정할 근거가 부족해요. 오늘은 정답이 아니라 이번 주 확인할 사람 1명을 고릅니다.",
      question: "이걸 만들게 된 계기가 된 사람이나 상황이 있었나요?\n이번 주에 확인해볼 사람을 하나 골라주세요.",
      options: [
        {
          label: "나 또는 우리 팀",
          description: "내가 직접 겪는 문제라 바로 관찰하고 다시 써볼 수 있습니다.",
          nextIntent: "self_or_team_pain",
        },
        {
          label: "이미 불편하게 해결하는 사람",
          description: "스프레드시트, 수작업, 다른 툴로 이미 시간을 쓰고 있습니다.",
          nextIntent: "existing_alternative",
        },
        {
          label: "이미 돈이나 시간을 쓰는 사람",
          description: "예산, 일정, 팀 논의가 걸려 있어 검증 신호가 강합니다.",
          nextIntent: "budget_or_time_committed",
        },
        {
          label: "아직 모르겠어요",
          description: "괜찮아요. 오늘은 고객을 확정하지 않고 확인할 후보 3명을 찾습니다.",
          nextIntent: "unknown_find_candidates",
        },
      ],
      multiSelect: false,
      allowFreeText: true,
      freeTextPlaceholder: "예: 채용 담당자, 1인 개발자, 우리 CS팀",
      textMode: "short",
    },
  ],
};

export function initialIddStructuredInputForDoc(
  doc,
  {
    provider = "codex",
    onboardingHypothesis = null,
    onboardingContext = null,
  } = {},
) {
  if (provider !== "codex" || doc?.type !== "icp") return null;
  return buildAdaptiveIcpInitialInput({ onboardingHypothesis, onboardingContext });
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
  const personalizedOptions = buildAdaptiveOptions({ primaryUser, onboardingContext });
  return {
    toolName: "request_user_input",
    title: "첫 사용자 확인",
    questions: [
      {
        header: "프로젝트 이해",
        helperText,
        question,
        options: personalizedOptions,
        multiSelect: false,
        allowFreeText: true,
        freeTextPlaceholder: freeTextPlaceholderFor(primaryUser),
        textMode: "short",
      },
    ],
  };
}

function buildAdaptiveQuestion(hypothesis, primaryUser, projectKind) {
  if (hypothesis.confidence === "high" && primaryUser) {
    return `제가 보기엔 이 프로젝트는 ${primaryUser}가 겪는 문제를 풀려는 ${projectKind} 같아요.\n이번 주에 가장 먼저 만나서 확인해볼 사람은 누구인가요?`;
  }
  if (hypothesis.confidence === "medium") {
    const lead = naturalEvidenceLead(hypothesis.evidence);
    const problemGuess = primaryUser
      ? `${primaryUser} 쪽 문제가 먼저 보여요.`
      : "아직 첫 사용자를 단정하긴 어려워요.";
    return `${lead} ${problemGuess}\n이번 주에 만나서 "이게 진짜 문제인지" 확인해볼 사람은 누구인가요?`;
  }
  return "이걸 만들게 된 계기가 된 사람이나 상황이 있었나요?\n이번 주에 확인해볼 사람을 하나 골라주세요.";
}

function buildAdaptiveHelperText(hypothesis) {
  const evidence = (hypothesis.evidence || []).slice(0, 2);
  if (evidence.length > 0) {
    return `근거: ${evidence.join(" · ")}. 오늘은 정답이 아니라 이번 주 확인할 사람 1명을 고릅니다.`;
  }
  return "아직 단정할 근거가 부족해요. 오늘은 정답이 아니라 이번 주 확인할 사람 1명을 고릅니다.";
}

function buildAdaptiveOptions({ primaryUser, onboardingContext }) {
  const options = [];
  if (primaryUser) {
    options.push({
      label: shortenLabel(primaryUser),
      description: "이 가설이 맞다면 오늘 이 사람부터 만나 문제를 확인합니다.",
      nextIntent: "confirm_likely_user",
    });
  } else {
    options.push({
      label: defaultSelfOptionLabel(onboardingContext),
      description: "내가 직접 겪는 문제라 바로 관찰하고 다시 써볼 수 있습니다.",
      nextIntent: "self_or_team_pain",
    });
  }
  options.push(
    {
      label: "이미 불편하게 해결하는 사람",
      description: "스프레드시트, 수작업, 다른 툴로 이미 시간을 쓰고 있습니다.",
      nextIntent: "existing_alternative",
    },
    {
      label: "이미 돈이나 시간을 쓰는 사람",
      description: "예산, 일정, 팀 논의가 걸려 있어 검증 신호가 강합니다.",
      nextIntent: "budget_or_time_committed",
    },
    {
      label: "아직 모르겠어요",
      description: "괜찮아요. 오늘은 고객을 확정하지 않고 확인할 후보 3명을 찾습니다.",
      nextIntent: "unknown_find_candidates",
    },
  );
  return options;
}

function defaultSelfOptionLabel(onboardingContext) {
  const role = String(onboardingContext?.role || "").trim();
  if (role === "designer") return "나 같은 디자이너";
  if (role === "product_manager") return "나 같은 PM";
  if (role === "student") return "나 같은 학생";
  return "나 또는 우리 팀";
}

function freeTextPlaceholderFor(primaryUser) {
  if (primaryUser) {
    return `예: ${shortenLabel(primaryUser)}, 같은 팀 동료, 실제로 불편을 말한 사람`;
  }
  return "예: 우리 팀, 채용 담당자, 매일 Codex를 쓰는 개발자";
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
        "- office-hours 방식: 실제 수요, 현재 대안, 가장 절박한 사람, 가장 작은 유료/사용 가능 wedge를 묻고 추상 답변이면 실제 사람/상황/증거로 좁히세요.",
        "- plan-ceo-review 방식: 선택지에는 최소안, 이상안, 다른 관점을 함께 두고 추천 이유와 트레이드오프를 설명하세요.",
        "- design-review 방식: 관찰한 UI/문서/흐름에 대해 'I notice / I wonder / What if / I think because' 구조로 증거 기반 후속 질문을 만드세요.",
        "- devex-review 방식: Time to Hello World, 다음 행동의 명확성, 에러가 문제/원인/해결책을 알려주는지처럼 측정 가능한 개발자 경험 기준을 묻고 점수나 기준을 남기세요.",
      ].join("\n");
  return [
    iddPrompt,
    "",
    "## 이미 받은 첫 구조화 답변",
    "사용자가 host UI의 request_user_input 카드에서 첫 ICP 신호 질문에 답했습니다.",
    answer || "(응답 텍스트 없음)",
    "",
    "이 답변을 첫 인터뷰 입력으로 사용하세요. 같은 첫 고객 신호 질문을 반복하지 마세요.",
    "다음 질문부터는 반드시 현재 프로젝트의 실제 맥락에 맞춰 Adaptive/Personalized 인터뷰로 진행하세요.",
    "- 먼저 README, docs, package/config, 주요 소스, 최근 git 변경에서 관찰한 사실을 조합해 제품/사용자/제약 가설을 세우세요.",
    "- 질문은 그 가설의 가장 약한 부분을 검증하는 한 가지로 좁히고, question/options/freeTextPlaceholder에 관찰한 프로젝트 맥락을 반영하세요.",
    "- 어떤 프로젝트에도 붙일 수 있는 범용 질문이나 템플릿 질문을 반복하지 마세요.",
    "- 좋은 질문은 gstack review flow처럼 decision brief여야 합니다. 사용자가 무엇을 결정해야 하는지, 잘못 고르면 무엇이 깨지는지, 추천 선택지는 무엇인지 한 번에 보이게 만드세요.",
    "",
    specialistBlock,
    "",
    "- gstack 정렬 축을 매 질문에 적용하세요: 톤은 직접적이고 증거 중심, 단위는 한 질문=한 결정, 기준은 수요/범위/UX/DX/리스크, 사용 위치는 BIP 문서 완성 직전의 게이트, 실패 방지는 범용 문서/빈 결정/조용한 누락 차단입니다.",
    "- 대안/리스크/증거/실패 모드가 보이지 않는 질문은 좋은 IDD 질문이 아닙니다. 더 좁혀서 무엇을 선택해야 하는지, 어떤 근거가 있는지, 잘못 고르면 어떤 문서 실패가 생기는지 드러내세요.",
    "- 답변은 반드시 대상 문서의 섹션, 결정, Open Risks, 다음 BIP 공개 글감 중 하나로 연결하세요.",
    "- 추가 결정이나 누락 정보가 필요하면 반드시 request_user_input 도구로 한 질문씩 이어가세요.",
    "- 도구 호출 자체가 실패하면 사용자에게 모드나 환경 전환을 요구하지 말고 \"structured input tool unavailable\"만 짧게 보고하고 멈추세요.",
    "- Pushback 즉시 적용: 사용자의 답이 \"개발자/창업자/엔터프라이즈\" 같은 집합명사이면 다음 question을 회사명·직함·주당 시간으로 좁히고, \"다들 좋다고 한다/웨이팅리스트\" 류 사회적 증거이면 결제·문의·고장 시 분노로 받고, \"풀 플랫폼이 필요하다\" 류 광범위 비전이면 이번 주 결제 가능한 한 가지로 좁히세요. 사랑은 수요가 아닙니다.",
    "- Anti-Sycophancy: \"흥미로운 접근이에요\", \"여러 방법이 있어요\" 같은 칭찬 표현은 금지. 정중체는 유지하되 \"이 가정은 미확인이에요\" / \"근거가 부족해요\" 같은 사실 진술로 받으세요.",
  ].join("\n");
}

export function findRequiredLocalDocs(workspaceRoot, { fsImpl = fsSync } = {}) {
  return BIP_REQUIRED_LOCAL_DOCS.map((doc) => {
    const foundPath = doc.aliases.find((relativePath) => docPathExists(workspaceRoot, relativePath, fsImpl)) || null;

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
    const configuredFound = configuredPath
      ? docPathExists(workspaceRoot, configuredPath, fsImpl)
      : false;
    const foundPath = configuredPath
      ? (configuredFound ? configuredPath : null)
      : doc.aliases.find((relativePath) => docPathExists(workspaceRoot, relativePath, fsImpl)) || null;

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
  return findRequiredLocalDocsWithConfig(workspaceRoot, options).map((doc) => ({
    id: localDocRowId(doc.type),
    status: doc.found ? "done" : "pending",
    detail: doc.found
      ? `${doc.title} 문서 확인됨: ${doc.foundPath}`
      : `${doc.configuredPath || doc.canonicalPath} 문서를 IDD 인터뷰로 고정해야 해요.`,
    ...(doc.found ? { resourceName: doc.title, resourceUrl: doc.foundPath } : {}),
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
  return BIP_REQUIRED_LOCAL_DOCS.some((doc) => doc.type === type) ? type : null;
}

export function requiredDocByType(type) {
  return BIP_REQUIRED_LOCAL_DOCS.find((doc) => doc.type === type) || null;
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
      detail: "BIP 업무일지 Google Doc URL/ID가 연결되어야 해요.",
    });
  }
  if (!config.sheetId) {
    missingExternalRequirements.push({
      id: "googleSheet",
      title: "Google Sheet 게시글 일지",
      detail: "BIP 게시글 기록 Google Sheet URL/ID가 연결되어야 해요.",
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
  const missingLocal = (status?.missingLocalDocs ?? []).map((doc) => doc.title).join(", ");
  const missingExternal = (status?.missingExternalRequirements ?? []).map((item) => item.title).join(", ");
  const parts = [];
  if (missingLocal) parts.push(`로컬 문서: ${missingLocal}`);
  if (missingExternal) parts.push(`외부 연결: ${missingExternal}`);
  return parts.length
    ? `BIP 미션 전에 IDD 세팅이 필요합니다. ${parts.join(" / ")}`
    : "BIP 미션 세팅이 완료되었습니다.";
}

export function buildIddDocumentPrompt(doc, {
  provider = "codex",
  workspaceRoot = "",
  queue = [],
  specialistInjection = "",
} = {}) {
  const toolInstruction = provider === "claude"
    ? "사용자의 결정이나 누락 정보가 필요하면 반드시 AskUserQuestionTool(AskUserQuestion)을 사용하세요."
    : "사용자의 결정이나 누락 정보가 필요하면 반드시 request_user_input 도구를 사용하세요.";
  const structuredToolName = provider === "claude"
    ? "AskUserQuestionTool(AskUserQuestion)"
    : "request_user_input";
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
    `- ${structuredToolName} 호출이 필요한 상황에서 같은 내용을 prose/번호 목록으로 대신 묻지 마세요. 도구 호출 자체가 실패하면 사용자에게 모드나 환경 전환을 요구하지 말고 "structured input tool unavailable"만 짧게 보고하고 멈추세요.`,
    "- 도구 질문은 question/options/allowFreeText/freeTextPlaceholder/textMode를 채워 1개 질문 단위로 만드세요. 선택지는 2-4개로 제한하고, 추가 맥락 한 줄이 필요하면 allowFreeText=true로 둡니다.",
    "- 금지 예: \"1. 반복 사용 2. 도입 준비 3. 먼저 요청함\" 같은 번호 목록을 assistant 메시지로 출력하는 것.",
    "- 첫 고객 질문 예: title=\"첫 사용자 확인\", helperText=\"근거: README... 오늘은 정답이 아니라 이번 주 확인할 사람 1명을 고릅니다.\", question=\"제가 보기엔 이 프로젝트는 AI 코딩 도구를 쓰는 개발자가 겪는 문제를 풀려는 macOS 앱 같아요. 이번 주에 가장 먼저 만나서 확인해볼 사람은 누구인가요?\", options=[추론된 사용자, 이미 불편하게 해결하는 사람, 이미 돈이나 시간을 쓰는 사람, 아직 모르겠어요], allowFreeText=true, freeTextPlaceholder=\"예: 실제로 불편을 말한 사람\", textMode=\"short\".",
    "- 이 세션에서는 이 문서 하나만 다룹니다. 다른 문서 인터뷰를 섞지 마세요.",
    "- 질문은 한 번에 하나의 고레버리지 질문으로 하세요.",
    "- 뻔한 질문 대신 문제 정의, 핵심 가치, 타겟 사용자, 사용자 여정, 비즈니스 모델, 경쟁 환경, 기술 제약, MVP 우선순위, 우려 사항, 트레이드오프를 깊게 파고드세요.",
    "",
    "Pushback 표준 응답 (gstack /office-hours 패턴 5종):",
    "- 모호한 시장 → 구체성 강제. 사용자가 \"개발자\", \"창업자\", \"엔터프라이즈\" 같은 집합명사로 답하면 다음 question은 회사명/직함/주당 시간/구체 작업으로 좁히는 형태로 강제하세요. 예: \"그 개발자가 어떤 회사의 어떤 역할에서 주당 몇 시간을 [task]에 쓰는데? 한 명만 이름을 알려주세요.\"",
    "- 사회적 증거 → 수요 검증. \"다들 좋다고 한다\", \"웨이팅리스트가 있다\"는 답이 나오면 다음 question을 \"돈을 내겠다고 한 사람? 출시 시점을 물어본 사람? 프로토타입이 고장 났을 때 화낸 사람?\"으로 강제하세요. 사랑은 수요가 아닙니다.",
    "- 플랫폼 비전 → 웨지 도전. \"풀 플랫폼이 필요하다\"는 답이 나오면 다음 question을 \"이번 주 한 사용자가 결제할 가장 작은 한 가지가 뭐예요?\"로 좁히세요.",
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
    "4. 다음 BIP 공개 글감 한 문장 — 이번 인터뷰에서 BIP 포스트로 공개할 한 문장.",
    "5. 이번 주 단 하나의 구체 행동 — 전략이 아니라 행동. \"이번 주에 [구체 인물]을 만나서 [구체 질문] 확인하기\" 같은 형태. 답변에서 도출되지 않으면 다음 질문에서 반드시 요청하세요.",
    "",
    "Adaptive/Personalized 인터뷰 규칙:",
    "- 질문을 만들기 전에 현재 프로젝트의 README, docs, package/config, 주요 소스, 최근 git 변경을 확인해 실제 제품 맥락을 파악하세요.",
    "- 매 질문은 관찰한 프로젝트 사실에 연결되어야 합니다. 예: 실제 기능명, 화면, 사용자 흐름, 통합 서비스, 기술 제약, 최근 구현 변경, 설정된 BIP 문서 경로.",
    "- 사용자의 직전 답변을 다음 질문의 입력으로 삼아 선택지와 자유 입력 placeholder를 조정하세요.",
    "- 사용자가 모를 수 있는 내부 용어(ICP, ADR, BIP, MVP 등)는 질문 본문에서 먼저 쓰지 말고 쉬운 말로 풀어 쓰세요. 필요한 경우 괄호로만 짧게 보충하세요.",
    "- 답이 넓으면 더 좁히고, 답이 추상적이면 실제 사용자/상황/증거를 요구하고, 답이 모순되면 트레이드오프를 드러내는 질문으로 이어가세요.",
    "- 어떤 프로젝트에도 그대로 붙일 수 있는 범용 질문, 체크리스트식 질문, 템플릿 문구를 금지합니다.",
    "",
    "Review-grade 질문 규칙:",
    ...(specialistInjection
      ? ["- 위에서 라우팅된 specialist 모드의 사고 방식을 그대로 한 가지 질문으로 옮기세요. 다른 specialist를 동시에 흉내내지 마세요."]
      : [
        "- gstack office-hours 벤치마크: 질문은 실제 수요, 현재 대안, 특정 사람, 가장 작은 wedge를 검증해야 합니다. \"사용자\" 같은 범주 답변을 받으면 실제 이름/역할/상황/증거로 좁히세요.",
        "- gstack plan-ceo-review 벤치마크: 결정이 필요한 순간에는 최소안/이상안/대안 관점을 제시하고, 추천안과 잘못 골랐을 때의 리스크를 함께 적으세요.",
        "- gstack design-review 벤치마크: 시각/문서/흐름 판단은 관찰에서 시작하세요. \"I notice\", \"I wonder\", \"What if\", \"I think ... because\" 식의 증거 기반 사고를 한국어 질문으로 녹이세요.",
        "- gstack devex-review 벤치마크: 개발자 경험은 추측하지 말고 TTHW(Time to Hello World), 단계 수, 에러 메시지의 문제/원인/해결책, 다음 행동의 명확성처럼 측정 가능한 기준으로 묻고 기록하세요.",
      ]),
    "- 모든 질문은 한 가지 결정만 다룹니다. question은 outcome 중심으로 쓰고, options는 2-4개로 제한하며, 각 option description에는 구체적 결과/장점/리스크 중 하나가 보여야 합니다.",
    "- 질문에는 대안/리스크/증거/실패 모드가 드러나야 합니다. 사용자가 답하면 어떤 대안이 선택되고, 어떤 리스크가 남고, 어떤 증거가 문서에 들어가며, 무엇이 실패로 기록되는지 알 수 있어야 합니다.",
    "- 에러나 DX 마찰을 다룰 때는 problem/cause/fix 관점으로 묻고, 근거가 없으면 추측하지 말고 증거 출처를 요청하세요.",
    "- 가능하면 추천 선택지를 암시하되 사용자가 반대할 수 있게 만드세요. 추천 이유는 관찰한 프로젝트 사실이나 직전 답변에 연결되어야 합니다.",
    "- 문서 작성 전 마지막에는 리뷰 체크를 수행하세요: 남은 모순, 누락된 증거, 가장 위험한 가정, 다음 BIP 미션에서 공개해도 되는 한 문장 요약을 확인하세요.",
    "",
    "gstack 정렬 매트릭스:",
    "- 톤: IDD는 친절한 문서화 톤을 유지하되 gstack처럼 직접적이고 증거 중심이어야 합니다. 칭찬보다 관찰, 추측보다 근거, 애매한 답변보다 재질문을 우선하세요.",
    "- 단위: IDD의 기본 단위는 문서 하나가 아니라 질문 하나입니다. 한 질문은 한 결정만 닫아야 하며, 여러 결정을 묶어 묻지 마세요.",
    "- 기준: 질문마다 어떤 기준을 검증하는지 내부적으로 태그하세요. 가능한 기준은 수요 증거, 현재 대안, 좁은 wedge, 범위 선택, UX 신뢰, DX 마찰, 운영 리스크, 공개 가능한 BIP 증거입니다.",
    `- 사용 위치: 이 플로우는 구현 리뷰가 아니라 BIP 미션 전 문서 게이트입니다. 답변은 곧바로 ${doc.canonicalPath}의 섹션, 결정, 리스크, 다음 BIP 공개 글감으로 변환되어야 합니다.`,
    "- 답변은 대상 문서의 섹션, 결정, 리스크, 다음 BIP 공개 글감 중 하나로 연결되어야 합니다.",
    "- 실패 방지: 빈 문서, 누구에게나 붙는 템플릿 문장, 결정 없는 목록, 근거 없는 성공 기준, 조용히 빠진 리스크를 실패로 취급하세요. 발견하면 다음 질문에서 반드시 좁히거나 문서의 Open Risks에 남기세요.",
    "- 기존 문서나 README가 있으면 먼저 읽고, 이미 있는 포맷/톤/섹션을 보존하세요.",
    "- 충분히 명확해질 때까지 인터뷰를 계속하고, 끝나면 한국어 Markdown으로 파일을 생성/업데이트하세요.",
    "- 작성 후 변경 파일, 핵심 결정, 남은 리스크를 짧게 요약하세요.",
    "",
    "문서별 초점:",
    `- ${doc.focus}`,
    "",
    "시작 절차:",
    "1. 워크스페이스의 README와 docs 디렉터리를 짧게 확인하세요.",
    "2. 대상 파일 또는 호환 파일이 이미 있으면 섹션 구조를 확인하세요.",
    "3. 바로 구조화 질문 도구로 첫 질문을 하세요.",
    "4. 인터뷰 결과를 바탕으로 대상 파일을 저장하세요.",
  ].join("\n");
}

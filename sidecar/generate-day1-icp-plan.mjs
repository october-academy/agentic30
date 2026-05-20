import fs from "node:fs/promises";
import path from "node:path";

import {
  buildReadOnlyWorkspaceCanUseTool,
  READ_ONLY_WORKSPACE_ALLOWED_TOOLS,
} from "./read-only-workspace-tool-policy.mjs";

export const DAY1_ICP_PLAN_SCHEMA_VERSION = 1;
export const DAY1_ICP_PLAN_MIN_CONFIDENCE = 0.35;
export const DAY1_ICP_PLAN_DEFAULT_TIMEOUT_MS = 30_000;

const QUESTION_DIMENSIONS = Object.freeze([
  "must_have",
  "core_need",
  "current_alternative",
  "buyer_user",
  "activation_or_success_signal",
  "willingness_to_pay",
  "bad_fit_boundary",
  "reference_customer",
]);

const MAX_EVIDENCE_REFS = 8;
const MAX_DOC_CHARS = 8_000;
const MAX_CONTEXT_CHARS = 28_000;

export async function generateDay1IcpPlan({
  workspaceRoot,
  scanResult = {},
  onboardingHypothesis = null,
  localDiscovery = null,
  now = new Date(),
  fsImpl = fs,
} = {}) {
  const evidence = await collectDay1IcpEvidence({
    workspaceRoot,
    scanResult,
    fsImpl,
  });
  const signals = buildDay1IcpSignals({
    workspaceRoot,
    scanResult,
    onboardingHypothesis,
    localDiscovery,
    evidence,
  });
  const questions = buildAdaptiveQuestions(signals);
  const plan = {
    schemaVersion: DAY1_ICP_PLAN_SCHEMA_VERSION,
    source: "deterministic",
    generatedAt: toIso(now),
    confidence: confidenceScore(signals.confidence, evidence.length, questions.length),
    fellBackToDeterministic: false,
    mission: buildMission(signals),
    signals,
    questions,
    icpDraft: buildIcpDraft(signals, questions),
    antiIcp: buildAntiIcp(signals),
    firstInterviewMessage: buildFirstInterviewMessage(signals, questions),
  };
  return normalizeDay1IcpPlan(plan) || fallbackDay1IcpPlan({ workspaceRoot, now });
}

export async function composeDay1IcpPlan({
  workspaceRoot,
  deterministicPlan,
  queryImpl,
  now = new Date(),
  timeoutMs = DAY1_ICP_PLAN_DEFAULT_TIMEOUT_MS,
} = {}) {
  const fallback = normalizeDay1IcpPlan(deterministicPlan)
    || fallbackDay1IcpPlan({ workspaceRoot, now });

  if (typeof queryImpl !== "function") {
    return {
      ...fallback,
      source: "deterministic",
      fellBackToDeterministic: true,
    };
  }

  let composed = null;
  try {
    const canUseTool = buildReadOnlyWorkspaceCanUseTool({ workspaceRoot });
    const text = await runPlanComposerWithTimeout({
      queryImpl,
      prompt: buildDay1IcpComposerPrompt(fallback),
      workspaceRoot,
      canUseTool,
      timeoutMs,
    });
    composed = parseDay1IcpPlanText(text);
  } catch {
    composed = null;
  }

  const normalized = normalizeDay1IcpPlan(composed);
  if (!normalized || (normalized.confidence ?? 0) < DAY1_ICP_PLAN_MIN_CONFIDENCE) {
    return {
      ...fallback,
      source: "deterministic",
      fellBackToDeterministic: true,
    };
  }

  return {
    ...normalized,
    source: "llm",
    generatedAt: normalized.generatedAt || toIso(now),
    fellBackToDeterministic: false,
  };
}

export function parseDay1IcpPlanText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export function normalizeDay1IcpPlan(value) {
  if (!value || typeof value !== "object") return null;

  const signals = normalizeSignals(value.signals);
  const questions = normalizeQuestions(value.questions);
  const icpDraft = normalizeIcpDraft(value.icpDraft || value.icp_draft);
  const antiIcp = normalizeAntiIcp(value.antiIcp || value.anti_icp);
  const firstInterviewMessage = normalizeFirstInterviewMessage(
    value.firstInterviewMessage || value.first_interview_message,
  );
  const mission = cleanText(value.mission);

  if (!mission || !signals || questions.length < 3 || questions.length > 5) return null;
  if (!icpDraft || !antiIcp || !firstInterviewMessage) return null;

  return {
    schemaVersion: DAY1_ICP_PLAN_SCHEMA_VERSION,
    source: cleanToken(value.source) || "deterministic",
    generatedAt: cleanText(value.generatedAt || value.generated_at),
    confidence: clampNumber(value.confidence, 0, 1, 0.5),
    fellBackToDeterministic: Boolean(value.fellBackToDeterministic || value.fell_back_to_deterministic),
    mission,
    signals,
    questions,
    icpDraft,
    antiIcp,
    firstInterviewMessage,
  };
}

async function collectDay1IcpEvidence({ workspaceRoot, scanResult, fsImpl }) {
  if (!workspaceRoot) return [];
  const root = path.resolve(workspaceRoot);
  const candidates = [
    ["README.md", "README"],
    ["readme.md", "README"],
    ["package.json", "package metadata"],
    ...Object.entries(scanResult || {})
      .filter(([, relative]) => typeof relative === "string" && relative.trim())
      .map(([role, relative]) => [relative, `${role} document`]),
  ];

  const refs = [];
  for (const [relativePath, reason] of candidates) {
    if (refs.length >= MAX_EVIDENCE_REFS) break;
    const loaded = await readWorkspaceText({ root, relativePath, fsImpl });
    if (!loaded) continue;
    refs.push({
      path: loaded.relativePath,
      reason,
      quote: evidenceQuote(loaded.content),
    });
  }

  const discoveryRefs = await collectDiscoveryFileRefs({ root, fsImpl, existing: refs });
  refs.push(...discoveryRefs.slice(0, Math.max(0, MAX_EVIDENCE_REFS - refs.length)));
  return uniqueBy(refs, (item) => item.path).slice(0, MAX_EVIDENCE_REFS);
}

async function collectDiscoveryFileRefs({ root, fsImpl, existing }) {
  const existingPaths = new Set(existing.map((item) => item.path));
  const directories = ["interviews", "interview", "transcripts", "bip", "logs", "worklog", "notes", "docs"];
  const refs = [];
  for (const directory of directories) {
    let entries = [];
    try {
      entries = await fsImpl.readdir(path.join(root, directory), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (refs.length >= 3) return refs;
      if (!entry.isFile()) continue;
      if (!/\.(md|mdx|txt|json)$/i.test(entry.name)) continue;
      const relativePath = path.posix.join(directory, entry.name);
      if (existingPaths.has(relativePath)) continue;
      const loaded = await readWorkspaceText({ root, relativePath, fsImpl, maxChars: 2400 });
      if (!loaded) continue;
      refs.push({
        path: loaded.relativePath,
        reason: `${directory} signal`,
        quote: evidenceQuote(loaded.content),
      });
    }
  }
  return refs;
}

async function readWorkspaceText({ root, relativePath, fsImpl, maxChars = MAX_DOC_CHARS }) {
  if (typeof relativePath !== "string" || !relativePath.trim()) return null;
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) return null;
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  try {
    const stat = await fsImpl.stat(resolved);
    if (!stat.isFile() || stat.size > 2_000_000) return null;
    const content = await fsImpl.readFile(resolved, "utf8");
    return {
      relativePath: path.relative(root, resolved).split(path.sep).join(path.posix.sep),
      content: content.slice(0, maxChars),
    };
  } catch {
    return null;
  }
}

function buildDay1IcpSignals({
  workspaceRoot,
  scanResult,
  onboardingHypothesis,
  localDiscovery,
  evidence,
}) {
  const h = onboardingHypothesis || {};
  const productName = cleanText(h.productName) || inferProductName(workspaceRoot, evidence);
  const likelyUsers = normalizeStringArray(h.likelyUsers).slice(0, 5);
  const problem = cleanText(h.problem);
  const currentIcpGuess = cleanText(h.targetUser) || likelyUsers[0] || "";
  const confidence = cleanToken(h.confidence) || inferSignalConfidence({ evidence, currentIcpGuess, problem });
  return {
    productName,
    currentIcpGuess,
    likelyUsers,
    problem,
    currentAlternatives: inferCurrentAlternatives({
      projectKind: h.projectKind,
      context: evidenceContext(evidence),
      localDiscovery,
    }),
    evidenceRefs: evidence.map(normalizeEvidenceRef).filter(Boolean).slice(0, MAX_EVIDENCE_REFS),
    missingAssumptions: inferMissingAssumptions({
      scanResult,
      currentIcpGuess,
      problem,
      evidence,
      confidence,
    }),
    confidence,
  };
}

function buildMission(signals) {
  const product = signals.productName || "이 프로젝트";
  const target = signals.currentIcpGuess || "잠재 고객";
  const problem = signals.problem || "scan에서 보이는 핵심 문제";
  return `${product}의 ICP v0를 PostHog식으로 좁힙니다. ${target}라는 가설을 need / have / don't need 기준으로 검증 가능하게 만들고, "${problem}"을 실제로 겪는 reference customer를 찾을 질문과 docs/ICP.md 초안을 만듭니다.`;
}

function buildAdaptiveQuestions(signals) {
  const dimensions = chooseQuestionDimensions(signals);
  return dimensions.map((dimension, index) => {
    const built = questionForDimension(dimension, signals);
    return {
      id: `q${index + 1}_${dimension}`,
      dimension,
      title: built.title,
      prompt: built.prompt,
      helperText: built.helperText,
      options: built.options.map((option, optionIndex) => ({
        id: `o${optionIndex + 1}`,
        label: option.label,
        description: option.description,
        preview: option.preview || option.label,
        antiSignal: option.antiSignal === true,
      })),
      allowFreeText: true,
      freeTextPlaceholder: built.freeTextPlaceholder,
    };
  });
}

function chooseQuestionDimensions(signals) {
  const missing = new Set(signals.missingAssumptions || []);
  const confidence = signals.confidence || "low";
  if (confidence === "low" || missing.has("current_icp") || missing.has("core_need")) {
    return [
      "must_have",
      "core_need",
      "current_alternative",
      "buyer_user",
      "reference_customer",
    ];
  }
  if ((signals.evidenceRefs || []).length >= 4 && confidence === "high") {
    return [
      "must_have",
      "current_alternative",
      "bad_fit_boundary",
      "reference_customer",
    ];
  }
  return [
    "must_have",
    "core_need",
    "current_alternative",
    "bad_fit_boundary",
  ];
}

function questionForDimension(dimension, signals) {
  const product = signals.productName || "이 제품";
  const user = targetFragment(signals.currentIcpGuess || signals.likelyUsers?.[0] || "잠재 고객");
  const problem = problemFragment(signals.problem || "핵심 문제");
  const alternatives = signals.currentAlternatives?.length
    ? signals.currentAlternatives
    : ["스프레드시트/문서로 수동 처리", "기존 범용 도구 조합", "내부 스크립트나 임시 프로세스", "아직 뚜렷한 대안 없음"];

  switch (dimension) {
  case "must_have":
    return {
      title: "질문 — Must-have 조건",
      prompt: `${product}의 좋은 고객이라면 이미 갖고 있어야 하는 조건은 무엇인가요?`,
      helperText: "직함보다 '좋은 고객이면 이미 가지고 있는 조건'을 고릅니다.",
      freeTextPlaceholder: "예: 이미 같은 문제를 매주 직접 처리하고 있는 팀",
      options: [
        option(`${user}이고 ${problem}을 지금 해결하려는 사람/팀`, "대상과 need가 한 문장에 같이 들어갑니다.", "Description"),
        option(`${problem} 때문에 시간·돈·리스크 중 하나를 이미 쓰는 사람/팀`, "polite interest보다 실제 비용 신호를 우선합니다.", "Have"),
        option("반복 빈도가 높아 내부 프로세스나 체크리스트가 이미 생긴 사람/팀", "새 카테고리보다 기존 행동을 기준으로 좁힙니다.", "Have"),
        option("직접 입력: scan보다 더 정확한 필수 조건", "repo evidence가 약하면 founder knowledge로 보정합니다.", "Manual"),
      ],
    };
  case "core_need":
    return {
      title: "질문 — Core need",
      prompt: `이 ICP가 ${product}를 써야 하는 가장 날카로운 need는 무엇인가요?`,
      helperText: "해결하면 좋다가 아니라, 해결하지 않으면 지금 비용이 나는 문제를 고릅니다.",
      freeTextPlaceholder: "예: 고객 대응 전에 매번 로그를 뒤져야 해서 배포가 늦어짐",
      options: [
        option(`${problem}을 더 빨리 판단해야 한다`, "시간 절약이 가장 직접적인 가치일 때.", "Need"),
        option(`${problem}에서 실수·누락·리스크를 줄여야 한다`, "품질이나 신뢰 비용이 클 때.", "Need"),
        option("기존 방식으로는 반복 작업이 커져 더 이상 버티기 어렵다", "현재 대안이 이미 한계에 닿은 경우.", "Need"),
        option("팀/고객에게 결과를 설명할 증거가 필요하다", "문서화·공유·승인 병목이 핵심일 때.", "Need"),
      ],
    };
  case "current_alternative":
    return {
      title: "질문 — 현재 대안",
      prompt: "좋은 고객은 오늘 이 문제를 무엇으로 버티고 있나요?",
      helperText: "대체재가 선명할수록 가격, 메시지, wedge가 같이 좁아집니다.",
      freeTextPlaceholder: "예: Notion 템플릿 + 수동 CSV export",
      options: alternatives.slice(0, 4).map((labelValue) =>
        option(labelValue, "이 대안을 쓰는 사람만 첫 reference customer 후보로 봅니다.", "Alternative")
      ),
    };
  case "buyer_user":
    return {
      title: "질문 — 사용자와 구매자",
      prompt: "처음 써볼 사람과 돈/승인을 결정할 사람은 같은가요?",
      helperText: "초기 ICP는 sales cycle이 짧아야 테스트 속도가 납니다.",
      freeTextPlaceholder: "예: 개발자가 바로 카드 결제 가능하지만 보안 승인은 CTO가 봄",
      options: [
        option("사용자 본인이 바로 결정하고 결제/도입할 수 있다", "초기 reference customer로 가장 빠릅니다.", "Fast cycle"),
        option("사용자가 강하게 원하지만 팀 리드/대표 승인이 필요하다", "need 검증 뒤 buyer 질문이 필요합니다.", "Two-step"),
        option("사용자와 구매자가 다르고 예산 라인이 아직 불명확하다", "인터뷰에서 구매 흐름을 별도로 확인해야 합니다.", "Buyer risk"),
        option("아직 무료 사용/수동 검증만 가능하다", "ICP v0에는 남기되 매출 가설은 보류합니다.", "Learning"),
      ],
    };
  case "activation_or_success_signal":
    return {
      title: "질문 — 성공 신호",
      prompt: "이 ICP가 맞다면 어떤 행동이 가장 먼저 보여야 하나요?",
      helperText: "말보다 activation/retention으로 검증할 수 있는 행동을 고릅니다.",
      freeTextPlaceholder: "예: 첫 세션에서 팀원 2명을 초대하고 같은 작업을 반복 실행",
      options: [
        option("첫 사용 중 핵심 작업을 끝까지 완료한다", "activation event로 바로 측정할 수 있습니다.", "Activation"),
        option("같은 문제로 7일 안에 다시 돌아온다", "retention이 ICP 판단의 강한 근거가 됩니다.", "Retention"),
        option("동료/고객에게 결과를 공유하거나 초대한다", "real enthusiasm과 word-of-mouth 신호입니다.", "Referral"),
        option("비용/가격을 먼저 묻거나 결제 의사를 보인다", "willingness-to-pay 신호입니다.", "Pay intent"),
      ],
    };
  case "willingness_to_pay":
    return {
      title: "질문 — 지불 의향",
      prompt: "좋은 고객은 이 문제에 이미 어떤 비용을 쓰고 있나요?",
      helperText: "사랑하지만 안 사는 persona를 피하기 위한 질문입니다.",
      freeTextPlaceholder: "예: 매주 3시간 수작업, 월 $80 도구, 외주 비용",
      options: [
        option("유료 도구나 외주 비용을 이미 쓰고 있다", "가격 실험을 가장 빨리 할 수 있습니다.", "Paid alternative"),
        option("팀 시간이 반복적으로 들어가 인건비가 크다", "시간 비용을 가격 근거로 바꿀 수 있습니다.", "Time cost"),
        option("실패하면 매출/신뢰/보안 리스크가 생긴다", "risk reduction이 구매 이유가 됩니다.", "Risk cost"),
        option("아직 비용은 없고 관심만 있다", "Anti-ICP 후보로 두고 강한 행동 증거를 추가 확인합니다.", "Weak", true),
      ],
    };
  case "bad_fit_boundary":
    return {
      title: "질문 — Anti-ICP 경계",
      prompt: "이번 주 인터뷰에서 제외해야 할 신호는 무엇인가요?",
      helperText: "polite interest를 걸러야 Day 3 인터뷰가 실제 학습으로 이어집니다.",
      freeTextPlaceholder: "예: 데모에는 반응하지만 최근 사건, 대체재, 예산이 모두 없음",
      options: [
        option("\"흥미롭네요\"만 말하고 최근 사건이 없다", "가장 흔한 polite-interest 신호입니다.", "Exclude", true),
        option("문제는 있지만 직접 겪는 사람이 아니다", "proxy persona는 ICP v0를 흐립니다.", "Exclude", true),
        option("현재 대안도 비용도 없고 urgency가 없다", "need보다 curiosity에 가깝습니다.", "Exclude", true),
        option("구매/도입 권한이 너무 멀어 첫 테스트가 느리다", "초기 sales cycle을 길게 만듭니다.", "Exclude", true),
      ],
    };
  case "reference_customer":
  default:
    return {
      title: "질문 — Reference customer",
      prompt: "이 ICP v0를 이번 주에 누구에게 먼저 검증할 수 있나요?",
      helperText: "완벽한 대표 고객보다 바로 물어볼 수 있는 reference customer가 필요합니다.",
      freeTextPlaceholder: "예: 최근 같은 문제를 공개적으로 말한 팀 리드 1명",
      options: referenceCustomerOptions(signals, user),
    };
  }
}

function option(label, description, preview, antiSignal = false) {
  return { label, description, preview, antiSignal };
}

function referenceCustomerOptions(signals, user) {
  const likely = normalizeStringArray(signals.likelyUsers).filter(Boolean);
  const options = [];
  if (user && user !== "잠재 고객") {
    options.push(option(`${user} 중 최근 문제를 직접 말한 1명`, "current ICP guess를 바로 검증합니다.", "Reference"));
  }
  for (const likelyUser of likely) {
    if (options.length >= 3) break;
    if (options.some((item) => item.label.includes(likelyUser))) continue;
    options.push(option(`${targetFragment(likelyUser)} 중 warm intro 가능한 1명`, "scan의 likely user 후보를 실제 사람으로 바꿉니다.", "Warm"));
  }
  options.push(
    option("최근 같은 문제를 공개 글/이슈/커뮤니티에서 말한 사람", "cold outbound는 애매한 warm intro보다 정직한 신호를 줍니다.", "Cold"),
    option("직접 입력: 이번 주 20분 인터뷰를 요청할 수 있는 한 사람", "reference customer를 이름이나 채널까지 적습니다.", "Manual"),
  );
  return options.slice(0, 4);
}

function buildIcpDraft(signals, questions) {
  const target = signals.currentIcpGuess || signals.likelyUsers?.[0] || "아직 좁히는 중인 잠재 고객";
  const problem = signals.problem || "scan에서 확인한 핵심 문제";
  return {
    description: `${target} 중 ${problem}을 지금 해결하려는 고객.`,
    criteria: [
      "need가 오늘의 업무/매출/리스크에 연결된다",
      "현재 대안이나 반복 행동이 있다",
      "이번 주 20분 인터뷰를 요청할 수 있다",
    ],
    whyTheyMatter: [
      "초기 ICP는 넓은 persona가 아니라 테스트 가능한 고객 조건이어야 한다",
      "현재 대안과 지불/시간 비용이 있어야 pricing과 wedge를 배울 수 있다",
      "reference customer가 빠르게 잡혀야 Day 3 인터뷰 품질이 올라간다",
    ],
    needs: [
      problem,
      "문제를 더 빠르고 신뢰성 있게 해결할 방법",
    ].filter(Boolean),
    haves: [
      signals.currentAlternatives?.[0],
      signals.evidenceRefs?.[0]?.path ? `evidence: ${signals.evidenceRefs[0].path}` : null,
    ].filter(Boolean),
    dontNeeds: [
      "막연한 관심만 있고 최근 사건이 없는 사용자",
      "사용자는 아니지만 의견만 주는 proxy persona",
    ],
    evidence: (signals.evidenceRefs || []).map((ref) => `${ref.path}: ${ref.reason}`),
    referenceCustomersToFind: questions
      .find((question) => question.dimension === "reference_customer")
      ?.options.map((option) => option.label)
      .slice(0, 3) || ["이번 주 20분 인터뷰가 가능한 사람 1명"],
  };
}

function buildAntiIcp(signals) {
  return {
    summary: "좋은 반응보다 실제 need/have/behavior가 없으면 Day 3 인터뷰 대상에서 제외합니다.",
    rules: [
      {
        id: "polite_interest",
        label: "\"흥미롭네요\"만 말하고 최근 사건이 없음",
        reason: "polite interest는 PMF/ICP 신호가 아니라 대화 예절일 수 있습니다.",
        evidenceRef: null,
      },
      {
        id: "no_current_alternative",
        label: "현재 대안, 반복 행동, 시간/돈 비용이 없음",
        reason: "대체재가 없으면 pricing과 wedge를 검증하기 어렵습니다.",
        evidenceRef: null,
      },
      {
        id: "proxy_persona",
        label: "문제를 직접 겪지 않는 조언자/구경꾼",
        reason: `${signals.productName || "제품"}의 초기 persona를 흐립니다.`,
        evidenceRef: null,
      },
    ],
    politeInterestGuardrails: [
      "최근 7일 안의 실제 사건을 묻는다",
      "지금 쓰는 대안과 비용을 묻는다",
      "추천할 사람보다 본인이 겪는 문제를 먼저 묻는다",
    ],
  };
}

function buildFirstInterviewMessage(signals, questions) {
  const product = signals.productName || "이 프로젝트";
  const target = signals.currentIcpGuess || "이 문제를 직접 겪는 분";
  const problem = signals.problem || "지금 해결하려는 문제";
  const messageQuestions = questions.slice(0, 3).map((question) => question.prompt);
  return {
    channel: "DM/email/Slack",
    recipientPlaceholder: "{name}",
    subject: `${product} ICP v0 인터뷰 요청`,
    bodyTemplate: [
      "안녕하세요 {name}님,",
      `${product}의 첫 ICP를 좁히는 중인데, ${target} 중에서 "${problem}"을 실제로 겪는 분을 찾고 있습니다.`,
      "이번 주 20분만 짧게 여쭤볼 수 있을까요? 제품 소개보다 지금 쓰는 대안과 최근 사건을 듣고 싶습니다.",
      "",
      "질문은 세 가지만 드릴게요:",
      ...messageQuestions.map((question, index) => `${index + 1}) ${question}`),
      "",
      "부담되면 텍스트로 답해주셔도 괜찮습니다.",
    ].join("\n"),
    questions: messageQuestions,
  };
}

function inferCurrentAlternatives({ projectKind, context, localDiscovery }) {
  const lower = String(context || "").toLowerCase();
  const stacks = new Set(localDiscovery?.project?.stacks || []);
  const alternatives = [];
  const add = (value) => {
    if (value && !alternatives.includes(value)) alternatives.push(value);
  };

  if (/notion|spreadsheet|sheet|csv|airtable/.test(lower)) {
    add("스프레드시트/Notion/Airtable로 수동 관리");
  }
  if (/slack|email|gmail|inbox|support/.test(lower)) {
    add("Slack/메일 thread를 사람이 직접 확인");
  }
  if (/github|issue|pull request|pr|code|developer|cli|sdk/.test(lower) || stacks.has("node") || stacks.has("swift")) {
    add("GitHub/IDE/CLI와 수동 스크립트 조합");
  }
  if (/analytics|posthog|dashboard|metric/.test(lower)) {
    add("analytics dashboard를 직접 뒤져서 판단");
  }
  if (projectKind === "web_app") add("기존 SaaS와 내부 운영 문서 조합");
  if (projectKind === "developer_tool") add("터미널/에디터 플러그인과 자체 스크립트");

  add("범용 AI/검색/문서 도구로 임시 해결");
  add("아직 명확한 대안 없이 미루는 상태");
  return alternatives.slice(0, 4);
}

function inferMissingAssumptions({ scanResult, currentIcpGuess, problem, evidence, confidence }) {
  const missing = [];
  if (!currentIcpGuess) missing.push("current_icp");
  if (!problem) missing.push("core_need");
  if (!scanResult?.icp) missing.push("icp_doc");
  if (!scanResult?.spec) missing.push("spec_doc");
  if (!scanResult?.goal) missing.push("goal_doc");
  if ((evidence || []).length < 2) missing.push("evidence");
  if (confidence === "low") missing.push("reference_customer");
  return missing.slice(0, 8);
}

function inferSignalConfidence({ evidence, currentIcpGuess, problem }) {
  const score = (evidence?.length || 0) + (currentIcpGuess ? 2 : 0) + (problem ? 2 : 0);
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function confidenceScore(confidence, evidenceCount, questionCount) {
  const base = confidence === "high" ? 0.78 : confidence === "medium" ? 0.58 : 0.36;
  const evidenceBonus = Math.min(0.12, Math.max(0, evidenceCount) * 0.02);
  const questionPenalty = questionCount > 4 ? 0.03 : 0;
  return Math.max(0.2, Math.min(0.92, Number((base + evidenceBonus - questionPenalty).toFixed(2))));
}

function buildDay1IcpComposerPrompt(plan) {
  return [
    "You are improving a Day 1 ICP v0 plan for a startup onboarding flow.",
    "Use PostHog's ICP pattern: start with the best guess; define Description, Criteria, Why they matter, Needs, Haves, Don't needs; prefer actual need/have/behavior over industry/title proxies; separate ICP from persona; include Anti-ICP guardrails for polite interest.",
    "You may inspect the workspace with read-only tools only. Do not edit files. Do not run commands.",
    "Return one JSON object matching the provided schema. Keep 3-5 adaptive questions. Do not force fixed axes like distance/tools/stuck/last7d unless the workspace evidence makes them truly relevant.",
    "",
    "DETERMINISTIC_PLAN_JSON:",
    JSON.stringify(plan, null, 2).slice(0, MAX_CONTEXT_CHARS),
  ].join("\n");
}

async function runPlanComposerWithTimeout({ queryImpl, prompt, workspaceRoot, canUseTool, timeoutMs }) {
  const abortController = new AbortController();
  const llmCall = Promise.resolve(queryImpl({
    prompt,
    options: {
      cwd: workspaceRoot,
      allowedTools: [...READ_ONLY_WORKSPACE_ALLOWED_TOOLS],
      tools: [...READ_ONLY_WORKSPACE_ALLOWED_TOOLS],
      canUseTool,
      abortController,
    },
  }));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      abortController.abort();
      reject(new Error("day1_icp_plan_timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([llmCall, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function fallbackDay1IcpPlan({ workspaceRoot, now = new Date() } = {}) {
  const productName = inferProductName(workspaceRoot, []);
  const signals = {
    productName,
    currentIcpGuess: "",
    likelyUsers: [],
    problem: "",
    currentAlternatives: ["스프레드시트/문서로 수동 처리", "기존 범용 도구 조합", "내부 스크립트나 임시 프로세스", "아직 뚜렷한 대안 없음"],
    evidenceRefs: [],
    missingAssumptions: ["current_icp", "core_need", "evidence", "reference_customer"],
    confidence: "low",
  };
  const questions = buildAdaptiveQuestions(signals);
  return {
    schemaVersion: DAY1_ICP_PLAN_SCHEMA_VERSION,
    source: "deterministic",
    generatedAt: toIso(now),
    confidence: 0.32,
    fellBackToDeterministic: true,
    mission: buildMission(signals),
    signals,
    questions,
    icpDraft: buildIcpDraft(signals, questions),
    antiIcp: buildAntiIcp(signals),
    firstInterviewMessage: buildFirstInterviewMessage(signals, questions),
  };
}

function normalizeSignals(value) {
  if (!value || typeof value !== "object") return null;
  const confidence = cleanToken(value.confidence) || "low";
  return {
    productName: cleanText(value.productName || value.product_name),
    currentIcpGuess: cleanText(value.currentIcpGuess || value.current_icp_guess),
    likelyUsers: normalizeStringArray(value.likelyUsers || value.likely_users).slice(0, 6),
    problem: cleanText(value.problem),
    currentAlternatives: normalizeStringArray(value.currentAlternatives || value.current_alternatives).slice(0, 6),
    evidenceRefs: normalizeEvidenceRefs(value.evidenceRefs || value.evidence_refs).slice(0, MAX_EVIDENCE_REFS),
    missingAssumptions: normalizeStringArray(value.missingAssumptions || value.missing_assumptions).slice(0, 10),
    confidence: ["low", "medium", "high"].includes(confidence) ? confidence : "low",
  };
}

function normalizeQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((question, index) => normalizeQuestion(question, index))
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeQuestion(value, index) {
  if (!value || typeof value !== "object") return null;
  const dimension = cleanToken(value.dimension);
  if (!QUESTION_DIMENSIONS.includes(dimension)) return null;
  const title = cleanText(value.title) || `질문 ${index + 1}`;
  const prompt = cleanText(value.prompt || value.question);
  const options = Array.isArray(value.options)
    ? value.options.map((optionValue, optionIndex) => normalizeQuestionOption(optionValue, optionIndex)).filter(Boolean)
    : [];
  if (!prompt || options.length < 2) return null;
  return {
    id: cleanToken(value.id) || `q${index + 1}_${dimension}`,
    dimension,
    title,
    prompt,
    helperText: cleanText(value.helperText || value.helper_text),
    options: options.slice(0, 5),
    allowFreeText: value.allowFreeText !== false && value.allow_free_text !== false,
    freeTextPlaceholder: cleanText(value.freeTextPlaceholder || value.free_text_placeholder),
  };
}

function normalizeQuestionOption(value, index) {
  if (!value || typeof value !== "object") return null;
  const label = cleanText(value.label || value.title);
  const description = cleanText(value.description || value.detail);
  if (!label || !description) return null;
  return {
    id: cleanToken(value.id) || `o${index + 1}`,
    label,
    description,
    preview: cleanText(value.preview),
    antiSignal: Boolean(value.antiSignal || value.anti_signal),
  };
}

function normalizeIcpDraft(value) {
  if (!value || typeof value !== "object") return null;
  const description = cleanText(value.description);
  if (!description) return null;
  return {
    description,
    criteria: normalizeStringArray(value.criteria).slice(0, 8),
    whyTheyMatter: normalizeStringArray(value.whyTheyMatter || value.why_they_matter).slice(0, 8),
    needs: normalizeStringArray(value.needs).slice(0, 8),
    haves: normalizeStringArray(value.haves).slice(0, 8),
    dontNeeds: normalizeStringArray(value.dontNeeds || value.dont_needs || value["don'tNeeds"]).slice(0, 8),
    evidence: normalizeStringArray(value.evidence).slice(0, 10),
    referenceCustomersToFind: normalizeStringArray(value.referenceCustomersToFind || value.reference_customers_to_find).slice(0, 6),
  };
}

function normalizeAntiIcp(value) {
  if (!value || typeof value !== "object") return null;
  const summary = cleanText(value.summary);
  const rules = Array.isArray(value.rules)
    ? value.rules.map(normalizeAntiIcpRule).filter(Boolean).slice(0, 6)
    : [];
  if (!summary || rules.length === 0) return null;
  return {
    summary,
    rules,
    politeInterestGuardrails: normalizeStringArray(value.politeInterestGuardrails || value.polite_interest_guardrails).slice(0, 6),
  };
}

function normalizeAntiIcpRule(value, index) {
  if (!value || typeof value !== "object") return null;
  const label = cleanText(value.label);
  const reason = cleanText(value.reason);
  if (!label || !reason) return null;
  return {
    id: cleanToken(value.id) || `anti_${index + 1}`,
    label,
    reason,
    evidenceRef: cleanText(value.evidenceRef || value.evidence_ref),
  };
}

function normalizeFirstInterviewMessage(value) {
  if (!value || typeof value !== "object") return null;
  const bodyTemplate = cleanText(value.bodyTemplate || value.body_template);
  if (!bodyTemplate) return null;
  return {
    channel: cleanText(value.channel) || "DM/email/Slack",
    recipientPlaceholder: cleanText(value.recipientPlaceholder || value.recipient_placeholder) || "{name}",
    subject: cleanText(value.subject),
    bodyTemplate,
    questions: normalizeStringArray(value.questions).slice(0, 5),
  };
}

function normalizeEvidenceRefs(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeEvidenceRef).filter(Boolean);
}

function normalizeEvidenceRef(value) {
  if (!value || typeof value !== "object") return null;
  const refPath = cleanText(value.path);
  if (!refPath) return null;
  return {
    path: refPath,
    reason: cleanText(value.reason),
    quote: cleanText(value.quote),
  };
}

function inferProductName(workspaceRoot, evidence) {
  const readmeHeading = evidence
    .map((item) => item.quote)
    .find((quote) => /^#\s+/.test(quote || ""));
  if (readmeHeading) return cleanText(readmeHeading.replace(/^#+\s*/, ""));
  const base = workspaceRoot ? path.basename(path.resolve(workspaceRoot)) : "";
  return base && !/^workspace-[a-z0-9]+$/i.test(base) ? base : "이 프로젝트";
}

function evidenceContext(evidence) {
  return (evidence || [])
    .map((item) => `${item.path}\n${item.reason || ""}\n${item.quote || ""}`)
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);
}

function evidenceQuote(content) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("<!--"));
  const heading = lines.find((line) => /^#{1,3}\s+/.test(line));
  const useful = heading || lines.find((line) => line.length >= 20) || lines[0] || "";
  return cleanText(useful).slice(0, 220);
}

function targetFragment(value) {
  const text = cleanText(value);
  if (!text) return "잠재 고객";
  return text.split(/[.,，、]/)[0].trim().slice(0, 60);
}

function problemFragment(value) {
  const text = cleanText(value);
  if (!text) return "핵심 문제";
  return text.split(/[.,，、]/)[0].trim().slice(0, 72);
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function cleanToken(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return uniqueBy(value.map(cleanText).filter(Boolean), (item) => item);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

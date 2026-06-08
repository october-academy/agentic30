import { CODEX_STRUCTURED_INPUT_TOOL } from "./structured-input-tools.mjs";

export function clampOfficeHoursContext(context = "") {
  return String(context || "").trim().slice(0, 16_000);
}

export function officeHoursStructuredInputToolName(provider = "codex") {
  return String(provider || "").toLowerCase() === "claude"
    ? "AskUserQuestion"
    : CODEX_STRUCTURED_INPUT_TOOL;
}

export function isOfficeHoursWriteDesignDocContext(context = "") {
  return /\bstart\s+startup\s+--write-design-doc\b/i.test(String(context || ""))
    || /Flow contract:\s*fixed Startup design-doc flow/i.test(String(context || ""));
}

export function isOfficeHoursLockedDay1GoalContext(context = "") {
  return /DAY1_LOCKED_GOAL|Flow contract:\s*locked Day 1 goal interview/i.test(String(context || ""));
}

export function buildOfficeHoursChatPrompt({ context = "", userPrompt = "" } = {}) {
  const sections = [
    "Office Hours를 시작한다.",
    "지금까지 project, scan, workspace, 그리고 사용자가 Day 1 STEP에서 질의응답한 내용을 바탕으로 YC Office Hours 대화를 진행한다.",
    "첫 응답은 현재 핵심 가설을 3-4줄로 요약한 뒤, 현재 mode/stage에 맞는 가장 약한 가정 하나를 겨냥하는 질문 정확히 1개만 물어본다.",
    "Day 1에서 Startup mode가 이미 선택되어 있으면 mode gate를 반복하지 않는다. product stage가 불명확하면 stage card를 먼저 묻는다.",
  ];
  const trimmedContext = clampOfficeHoursContext(context);
  const trimmedUserPrompt = String(userPrompt || "").trim();
  if (trimmedContext) {
    sections.push("## Context");
    sections.push(trimmedContext);
  }
  if (trimmedUserPrompt) {
    sections.push("## User Request");
    sections.push(trimmedUserPrompt);
  }
  return sections.join("\n\n");
}

export function buildOfficeHoursChatSystemPrompt(workspaceRootValue, {
  specialistInjection = "",
  context = "",
  provider = "codex",
} = {}) {
  const structuredInputTool = officeHoursStructuredInputToolName(provider);
  const isWriteDesignDocFlow = isOfficeHoursWriteDesignDocContext(context);
  const isLockedDay1GoalFlow = isOfficeHoursLockedDay1GoalContext(context);
  const baseRules = [
    "## Agentic30 Day 1 STEP Office Hours",
    "Use the office-hours specialist for this whole session.",
    "Keep this as a chat conversation, not a one-shot report.",
    "Ask one forcing decision at a time. Push vague answers toward names, recent behavior, money/time cost, current alternatives, and the smallest paid entry point. In Korean output, say 현재 대안 and 작은 유료 진입점.",
    "Preserve the explicit Office Hours mode: startup, intrapreneurship, or builder. Startup and intrapreneurship also need product stage: pre_product, has_users, has_paying_customers, or engineering_infra.",
    "If Day 1 context already selected Startup mode, do not ask the mode gate again. If stage is unclear, ask one stage card before diagnostic questions.",
    "Startup smart routing: pre_product -> Q1 Demand Reality, Q2 현재 대안, Q3 절실한 사람; has_users -> Q2 현재 대안, Q4 가장 좁은 첫 진입점, Q5 직접 관찰; has_paying_customers -> Q4 가장 좁은 첫 진입점, Q5 직접 관찰, Q6 앞으로 더 중요해질 이유; engineering_infra -> Q2 현재 대안, Q4 가장 좁은 첫 진입점.",
    "Smart-skip questions whose answers are already clear from Day 1 answers or the previous Office Hours conversation record. Do not force all six questions.",
    `The first forcing question and every later forcing question MUST be asked with ${structuredInputTool}; do not ask an Office Hours question only in plain prose.`,
    `For Q1 Demand Reality, use one ${structuredInputTool} request containing exactly one question with exactly four demand evidence choices.`,
    "Q1 demand evidence choice must ask: \"Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?\" Exclude feelings, praise, \"좋아 보인다\", and \"나오면 써보겠다\". Only real-name/date/action evidence counts.",
    "Q1 demand evidence options must be exactly: 실제 결제/계약이 있었다; 구매 조건이 구체적으로 확인됐다; 현재 대안에 돈/시간을 쓰고 있다; 관심만 있거나 아직 증거가 없다.",
    "Q1 must not ask for a separate evidence sentence or separate weakness selection. Keep requiresFreeText: false and allowFreeText: false so one click can advance.",
    "Fold each option's likely weakness or next evidence gap into its description/metadata instead of making the user answer another Q1 subquestion.",
    "Price questions are not strong money signals. Treat \"얼마예요?\" as 말뿐인 관심 unless actual payment, payment process, current alternative cost, or repeated behavior is present.",
    `After Q1, each ${structuredInputTool} call must contain exactly one question, 2-4 options, allowFreeText: true, and requiresFreeText: false.`,
    "Each option should include a decision-brief-lite: label, description, recommended when applicable, risk, evidenceTarget, mapsTo, and failureMode. Keep label/description useful even if the host ignores extra metadata.",
    "Option descriptions must name at least one of: selected outcome, concrete risk, evidence that will be captured, or the remaining evidence gap.",
    "In user-visible Korean copy, follow docs/JARGON.md: prefer plain action words over jargon. Say 고객 후보 instead of ICP, 현재 대안 instead of status quo, 작은 유료 진입점 instead of wedge, 작업 흐름 instead of workflow, and 제외 신호 instead of Anti-ICP unless the user's own wording requires the term.",
    "Optionally attach an emphasis array to the question to highlight key spans. Each item is { phrase, style }: phrase MUST be an exact substring of the question text; style is strong (key nouns, numbers, quotes), mark (warnings, deadlines, the single most important phrase), or code (file names, paths, code tokens). Use 1-5 spans, never more, and never emphasize most of the sentence.",
    "For a free-text chat reply (no structured input card), you may emphasize key spans of your reply with an emphasis sentinel block appended at the very end. Do NOT use inline markup like ** or ==; only the sentinel block. Wire format: the visible reply body, then a new line `===EMPHASIS===`, then a JSON array `[{ \"phrase\": \"<exact substring of the reply>\", \"style\": \"strong|mark|code\" }]`, then `===END===`. style is strong (key nouns, numbers, quotes), mark (warnings, deadlines, the single most important phrase), or code (file names, paths, code tokens). phrase MUST be an exact substring of the reply body. Use 1-5 spans, never more, never emphasize most of the reply, and omit the block entirely when nothing needs emphasis. The host strips this block so the user only sees the reply body.",
    "Recommended options are allowed, but the user must still be able to disagree.",
    "For this Day 1 Office Hours surface, prefer the host structured input tool over inline_decision sentinel JSON so the Mac app renders a pendingUserInput card.",
    "Never present numbered prose choices or markdown bullet choices as the only way to answer.",
    "Use workspace facts and Day 1 answers before broad startup advice.",
    "After the routed forcing questions are sufficiently answered, close with exactly two terminal cards: first `전제 확인` (signalId: office_hours_premise_challenge), then `대안 비교` (signalId: office_hours_alternatives).",
    "전제 확인 must test: whether this is the right problem, what happens if the user does nothing, what existing code/user flow can be reused, and the strongest remaining startup evidence gap.",
    "대안 비교 must contain 최소안, 이상안, and 다른 관점. Mark one as recommended, but do not write docs or implement anything until the user explicitly approves.",
    "Before any external search, ask a privacy gate card using generalized category terms only; if skipped, continue with in-distribution knowledge.",
    "Do not edit files or write artifacts unless the user explicitly asks for implementation or document writing later.",
  ];
  const writeDesignDocRules = isWriteDesignDocFlow
    ? [
        "For the `start startup --write-design-doc` screen, override the broad routing above with a fixed startup design-document flow.",
        "Do not ask mode, product-stage, privacy, or smart-skip gates on this screen.",
        "Ask exactly six startup forcing decisions in this order when missing: real demand evidence, current alternative, reachable person, smallest paid entry point, observed behavior, future importance. In Korean output, label them 수요 증거, 현재 대안, 연락 가능한 사람, 작은 유료 진입점, 관찰한 행동, 앞으로 더 중요해질 이유.",
        `The demand decision MUST use the one-question Q1 demand evidence card above. Each later decision MUST use ${structuredInputTool} with exactly one question, 2-4 options, allowFreeText: true, and requiresFreeText: false.`,
        "After the sixth answer, do not ask 전제 확인 or 대안 비교 as more structured input. Return generated design-doc markdown with frontmatter generated_by: office-hours and handoff_for: plan-ceo-review, including these Korean section headings: 문제 정의, 대상 사용자, 선택한 첫 진입점, 전제 확인, 검토한 대안, 이번에는 제외, 다음 행동, CEO 리뷰 인계.",
      ]
    : [];
  const lockedDay1GoalRules = isLockedDay1GoalFlow
    ? [
        "For the locked Day 1 goal interview, do not ask a mode gate, product-stage gate, or goal-selection question.",
        "Use only the locked goal block as the interview target: goal type, goal text, customer, problem, and validation action are already chosen by the user.",
        `The first response MUST call ${structuredInputTool} with exactly one question card. Do not answer only in prose.`,
        "Ask for the weakest missing evidence behind the locked goal first: money signal for make_money, acquisition/channel signal for get_users, or build flow/user-success signal for build_product.",
        "Each locked-goal interview question must ask one decision at a time, with 2-4 options, allowFreeText: true, and requiresFreeText: false.",
        "Do not write files, write docs, publish posts, or update public channels unless the user explicitly approves that later.",
        "If public evidence logging is available, treat it only as a place to record evidence after the interview; do not require public-log setup to continue.",
      ]
    : [];
  return [
    ...baseRules,
    ...writeDesignDocRules,
    ...lockedDay1GoalRules,
    `Workspace root: ${workspaceRootValue || ""}`,
    specialistInjection ? `\n${specialistInjection}` : "",
    context ? `\n## Day 1 STEP Office Hours Context\n${clampOfficeHoursContext(context)}` : "",
  ].filter(Boolean).join("\n");
}

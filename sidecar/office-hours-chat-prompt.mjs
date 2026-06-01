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
  const baseRules = [
    "## Agentic30 Day 1 STEP Office Hours",
    "Use the office-hours specialist for this whole session.",
    "Keep this as a chat conversation, not a one-shot report.",
    "Ask one forcing question at a time. Push vague answers toward names, recent behavior, money/time cost, status quo, and the narrowest wedge.",
    "Preserve the explicit Office Hours mode: startup, intrapreneurship, or builder. Startup and intrapreneurship also need product stage: pre_product, has_users, has_paying_customers, or engineering_infra.",
    "If Day 1 context already selected Startup mode, do not ask the mode gate again. If stage is unclear, ask one stage card before diagnostic questions.",
    "Startup smart routing: pre_product -> Q1 Demand Reality, Q2 Status Quo, Q3 Desperate Specificity; has_users -> Q2 Status Quo, Q4 Narrowest Wedge, Q5 Observation; has_paying_customers -> Q4 Narrowest Wedge, Q5 Observation, Q6 Future-Fit; engineering_infra -> Q2 Status Quo, Q4 Narrowest Wedge.",
    "Smart-skip questions whose answers are already clear from Day 1 answers or the previous Office Hours transcript. Do not force all six questions.",
    `The first forcing question and every later forcing question MUST be asked with ${structuredInputTool}; do not ask an Office Hours question only in plain prose.`,
    `Each ${structuredInputTool} call must contain exactly one question, 2-4 options, allowFreeText: true, and requiresFreeText: false.`,
    "Each option should include a decision-brief-lite: label, description, recommended when applicable, risk, evidenceTarget, mapsTo, and failureMode. Keep label/description useful even if the host ignores extra metadata.",
    "Option descriptions must name at least one of: selected outcome, concrete risk, evidence that will be captured, or the remaining evidence gap.",
    "Recommended options are allowed, but the user must still be able to disagree.",
    "For this Day 1 Office Hours surface, prefer the host structured input tool over inline_decision sentinel JSON so the Mac app renders a pendingUserInput card.",
    "Never present numbered prose choices or markdown bullet choices as the only way to answer.",
    "Use workspace facts and Day 1 answers before generic startup advice.",
    "After the routed forcing questions are sufficiently answered, close with exactly two terminal cards: first `Premise Challenge` (signalId: office_hours_premise_challenge), then `Alternatives` (signalId: office_hours_alternatives).",
    "Premise Challenge must test: whether this is the right problem, what happens if the user does nothing, what existing code/workflow can be reused, and the strongest remaining startup evidence gap.",
    "Alternatives must contain 최소안, 이상안, and 다른 관점. Mark one as recommended, but do not write docs or implement anything until the user explicitly approves.",
    "Before any external search, ask a privacy gate card using generalized category terms only; if skipped, continue with in-distribution knowledge.",
    "Do not edit files or write artifacts unless the user explicitly asks for implementation or document writing later.",
  ];
  const writeDesignDocRules = isWriteDesignDocFlow
    ? [
        "For the `start startup --write-design-doc` screen, override the generic routing above with a fixed Startup design-doc flow.",
        "Do not ask mode, product-stage, privacy, or smart-skip gates on this screen.",
        "Ask exactly six Startup questions in this order when missing: demand, status_quo, human, wedge, observation, future_fit.",
        `Each of those six questions MUST use ${structuredInputTool} with exactly one question, 2-4 options, allowFreeText: true, and requiresFreeText: false.`,
        "After the sixth answer, do not ask Premise Challenge or Alternatives as more structured input. Return generated design-doc markdown with frontmatter generated_by: office-hours and handoff_for: plan-ceo-review, including Problem Statement, Target User, Chosen Wedge, Premise Challenge, Explored Alternatives, Not In Scope, Next action, and CEO Review Handoff.",
      ]
    : [];
  return [
    ...baseRules,
    ...writeDesignDocRules,
    `Workspace root: ${workspaceRootValue || ""}`,
    specialistInjection ? `\n${specialistInjection}` : "",
    context ? `\n## Day 1 STEP Office Hours Context\n${clampOfficeHoursContext(context)}` : "",
  ].filter(Boolean).join("\n");
}

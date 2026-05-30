import { CODEX_STRUCTURED_INPUT_TOOL } from "./structured-input-tools.mjs";

export function clampOfficeHoursContext(context = "") {
  return String(context || "").trim().slice(0, 16_000);
}

export function officeHoursStructuredInputToolName(provider = "codex") {
  return String(provider || "").toLowerCase() === "claude"
    ? "AskUserQuestion"
    : CODEX_STRUCTURED_INPUT_TOOL;
}

export function buildOfficeHoursChatPrompt({ context = "", userPrompt = "" } = {}) {
  const sections = [
    "Office Hours를 시작한다.",
    "지금까지 project, scan, workspace, 그리고 사용자가 Day 1 STEP에서 질의응답한 내용을 바탕으로 YC Office Hours 대화를 진행한다.",
    "첫 응답은 현재 핵심 가설을 3-4줄로 요약한 뒤, 가장 약한 가정 하나를 겨냥하는 질문 정확히 1개만 물어본다.",
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
  return [
    "## Agentic30 Day 1 STEP Office Hours",
    "Use the office-hours specialist for this whole session.",
    "Keep this as a chat conversation, not a one-shot report.",
    "Ask one forcing question at a time. Push vague answers toward names, recent behavior, money/time cost, status quo, and the narrowest wedge.",
    `When a forcing question has choices, call ${structuredInputTool} with exactly one question, 2-4 options, allowFreeText: true, and requiresFreeText: false. Do not present numbered prose choices as the only way to answer.`,
    "Use workspace facts and Day 1 answers before generic startup advice.",
    "Do not edit files or write artifacts unless the user explicitly asks for implementation or document writing later.",
    `Workspace root: ${workspaceRootValue || ""}`,
    specialistInjection ? `\n${specialistInjection}` : "",
    context ? `\n## Day 1 STEP Office Hours Context\n${clampOfficeHoursContext(context)}` : "",
  ].filter(Boolean).join("\n");
}

export const CODEX_STRUCTURED_INPUT_TOOL = "agentic30_request_user_input";

export const STRUCTURED_INPUT_TOOL_ALIASES = [
  CODEX_STRUCTURED_INPUT_TOOL,
  "request_user_input",
  "ask_user_question",
  "AskUserQuestion",
  "AskUserQuestionTool",
];

export function isStructuredInputToolName(value) {
  return STRUCTURED_INPUT_TOOL_ALIASES.some((toolName) =>
    new RegExp(`\\b${escapeRegExp(toolName)}\\b`, "i").test(String(value || "")),
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

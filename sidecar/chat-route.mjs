export function classifyChatExecutionRoute(prompt, { qmdAvailable = false } = {}) {
  const value = String(prompt || "").trim();
  const lower = value.toLowerCase();

  if (requiresStructuredUserInputTool(value)) {
    return {
      executionMode: "agentic",
      reason: "structured_input_tool_required",
      contextSummary: "context=agentic_mcp",
    };
  }

  if (isInstantChatPrompt(value)) {
    return {
      executionMode: "instant_chat",
      reason: "instant_short_coaching",
      contextSummary: "context=cached_bip_only",
      inlineBipContext: true,
    };
  }

  const memoryKeywords = [
    "bip", "icp", "spec", "adr", "goal", "design", "문서", "docs", "sheet",
    "전략", "고객", "프로젝트", "기획", "로드맵", "목표", "디자인", "결정",
  ];
  const koreanTaskKeywords = [
    "수정", "고쳐", "만들", "생성", "찾아", "스캔", "파일",
    "코드", "테스트", "빌드", "열어", "저장", "삭제",
  ];
  const englishTaskPattern = /\b(rename|create|edit|fix|run|test|build|scan|search|open)\b/i;
  const hasMemoryIntent = memoryKeywords.some((keyword) => lower.includes(keyword));
  const hasTaskIntent =
    lower.startsWith("/")
    || koreanTaskKeywords.some((keyword) => lower.includes(keyword))
    || englishTaskPattern.test(value);

  if (hasTaskIntent) {
    return {
      executionMode: "agentic",
      reason: "task_intent",
      contextSummary: "context=agentic_mcp",
    };
  }
  if (hasMemoryIntent) {
    if (!qmdAvailable) {
      return {
        executionMode: "fast_chat",
        reason: "memory_intent_inline_bip",
        contextSummary: "context=fallback_bip_inline",
        inlineBipContext: true,
      };
    }
    return {
      executionMode: "memory_chat",
      reason: "memory_intent_qmd",
      contextSummary: "context=qmd_retrieval",
    };
  }
  return {
    executionMode: "fast_chat",
    reason: value.length <= 48 ? "short_general_prompt" : "general_prompt",
    contextSummary: "context=skipped",
  };
}

export function requiresStructuredUserInputTool(prompt) {
  const value = String(prompt || "");
  const lower = value.toLowerCase();
  const hasStructuredTool =
    /\brequest_user_input\b/i.test(value)
    || /\bask_user_question\b/i.test(value)
    || /\baskuserquestion(?:tool)?\b/i.test(value);
  if (!hasStructuredTool) {
    return false;
  }

  return [
    "/plan",
    "idd",
    "interview driven development",
    "구조화 입력",
    "ui에서 클릭/입력",
    "host ui",
    "structured input",
    "guided intake",
  ].some((hint) => lower.includes(hint));
}

function isInstantChatPrompt(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  if (/LIVE_DAY1_ICP_STEP_|DAY1_ICP_TURN_|AGENTIC30_FORCE_PROVIDER/i.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith("/")) return false;
  if (/\b(rename|create|edit|fix|run|test|build|scan|search|open|implement|refactor)\b/i.test(trimmed)) {
    return false;
  }
  if (/(수정|고쳐|만들|생성|찾아|스캔|파일|코드|테스트|빌드|열어|저장|삭제)/.test(trimmed)) {
    return false;
  }
  if (/(어디|위치|경로|문서|파일|찾아)/.test(trimmed) || /\b(where|path|location|file)\b/i.test(trimmed)) {
    return false;
  }
  const hasDay1CoachingIntent =
    /day\s*1|1일차|오늘|뭐부터|무엇부터|시작|icp|spec|builder-state|진단|fast path|proof baseline/i.test(trimmed);
  const asksForLocalCoaching =
    /(진단|정리|확인|추천|우선순위|뭐부터|무엇부터|어떻게|맞는 유저|기준)/.test(trimmed)
    || /\?/.test(trimmed);
  return trimmed.length <= 220 && hasDay1CoachingIntent && asksForLocalCoaching;
}

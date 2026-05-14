export const EDUCATION_DAY_WORKSHEET_SCHEMA_VERSION = 1;
export const EDUCATION_WORKSHEET_FEEDBACK_SCHEMA_VERSION = 1;

const DEFAULT_TITLE = "Education Day";
const DEFAULT_GOAL = "핵심 개념을 내 제품 상황에 맞게 적용한다";
const DEFAULT_INSTRUCTION = "빈칸을 짧게 채우면서 오늘 개념을 실제 실행 문장으로 바꿔보세요.";
const DEFAULT_INTENT = "교육 내용을 다음 Action Day에서 바로 쓸 수 있는 판단 기준으로 만든다.";

export function renderEducationDayWorksheet({
  daySpec = {},
  progress = {},
  requestId = null,
  sessionId = null,
  now = new Date(),
} = {}) {
  const normalizedDay = normalizeEducationDaySpec(daySpec);
  const worksheetProgress = ensureEducationWorksheetProgress(progress, {
    daySpec: normalizedDay,
    now: () => now,
  });
  const blanks = normalizedDay.blanks.map((blank) => {
    const answer = worksheetProgress.answers.find((entry) => entry.blankId === blank.id);
    return {
      ...blank,
      value: answer?.value ?? "",
      filled: Boolean(answer?.value),
      answeredAt: answer?.answeredAt ?? null,
    };
  });
  const segments = renderTemplateSegments(normalizedDay.template, blanks);
  const requiredBlanks = blanks.filter((blank) => blank.required);
  const completedBlankCount = requiredBlanks.filter((blank) => blank.filled).length;
  const totalBlankCount = requiredBlanks.length;
  const allBlanksFilled = totalBlankCount > 0 && completedBlankCount === totalBlankCount;
  const applicationFeedback = allBlanksFilled
    ? generateEducationWorksheetApplicationFeedback({
        daySpec: normalizedDay,
        progress: worksheetProgress,
        now,
      })
    : null;
  const cardBlocks = [
    {
      kind: "instruction",
      text: normalizedDay.instruction,
    },
    {
      kind: "worksheet",
      segments,
    },
    {
      kind: "completion",
      completedBlankCount,
      totalBlankCount,
      complete: allBlanksFilled,
    },
  ];
  if (applicationFeedback) {
    cardBlocks.push({
      kind: "framework_application_feedback",
      feedback: applicationFeedback.display,
    });
  }

  return {
    schemaVersion: EDUCATION_DAY_WORKSHEET_SCHEMA_VERSION,
    componentType: "curriculum_education_worksheet",
    dayId: normalizedDay.dayId,
    dayType: "education",
    dayGoal: normalizedDay.goal,
    title: normalizedDay.title,
    instruction: normalizedDay.instruction,
    intent: normalizedDay.intent,
    requestId: requestId || null,
    sessionId: sessionId || null,
    createdAt: toIso(now),
    worksheet: {
      template: normalizedDay.template,
      segments,
      blanks,
    },
    progress: {
      ...worksheetProgress,
      completedBlankCount,
      totalBlankCount,
      allBlanksFilled,
      completionReady: allBlanksFilled,
      completionConfirmed: worksheetProgress.completionConfirmed === true,
    },
    applicationFeedback,
    card: {
      layout: "education_interactive_worksheet",
      tone: "friendly_senior",
      state: allBlanksFilled ? "complete" : "in_progress",
      blocks: cardBlocks,
    },
  };
}

export function generateEducationWorksheetApplicationFeedback({
  daySpec = {},
  progress = {},
  now = new Date(),
} = {}) {
  const normalizedDay = normalizeEducationDaySpec(daySpec);
  const worksheetProgress = ensureEducationWorksheetProgress(progress, {
    daySpec: normalizedDay,
    now: () => now,
  });
  const requiredBlanks = normalizedDay.blanks.filter((blank) => blank.required);
  const completedBlankCount = countCompletedRequiredBlanks(requiredBlanks, worksheetProgress.answers);
  const allBlanksFilled = requiredBlanks.length > 0 && completedBlankCount === requiredBlanks.length;

  if (!allBlanksFilled) {
    return {
      schemaVersion: EDUCATION_WORKSHEET_FEEDBACK_SCHEMA_VERSION,
      componentType: "curriculum_education_framework_application_feedback",
      dayId: normalizedDay.dayId,
      dayType: "education",
      state: "waiting_for_answers",
      generatedAt: toIso(now),
      title: "프레임워크 적용 피드백",
      summary: "필수 빈칸을 모두 채우면 적용 피드백을 바로 보여드릴게요.",
      highlights: [],
      refinements: [],
      nextApplication: null,
      display: {
        layout: "education_framework_application_feedback",
        visible: false,
        blocks: [],
      },
    };
  }

  const answersByBlank = new Map(worksheetProgress.answers.map((answer) => [answer.blankId, answer]));
  const highlights = requiredBlanks.map((blank) => {
    const answer = answersByBlank.get(blank.id) ?? {};
    const assessment = assessWorksheetAnswer(answer.value);
    return {
      blankId: blank.id,
      label: blank.label,
      value: stringOrDefault(answer.value, ""),
      intent: blank.intent,
      assessment,
    };
  });
  const conciseCount = highlights.filter((entry) => entry.assessment === "concrete").length;
  const refinements = buildWorksheetFeedbackRefinements(highlights);
  const summary = conciseCount === highlights.length
    ? "오늘 프레임워크가 실행 문장으로 잘 내려왔습니다. 이 문장을 다음 Action Day의 기준으로 써보세요."
    : "핵심 구조는 잡혔습니다. 짧거나 추상적인 칸만 더 구체화하면 바로 실행 기준으로 쓸 수 있어요.";
  const nextApplication = buildNextApplicationPrompt(normalizedDay, highlights);

  return {
    schemaVersion: EDUCATION_WORKSHEET_FEEDBACK_SCHEMA_VERSION,
    componentType: "curriculum_education_framework_application_feedback",
    dayId: normalizedDay.dayId,
    dayType: "education",
    dayGoal: normalizedDay.goal,
    state: "ready",
    generatedAt: toIso(now),
    title: "프레임워크 적용 피드백",
    summary,
    highlights,
    refinements,
    nextApplication,
    display: {
      layout: "education_framework_application_feedback",
      visible: true,
      tone: "friendly_senior",
      blocks: [
        {
          kind: "summary",
          text: summary,
        },
        {
          kind: "answer_highlights",
          items: highlights.map((entry) => ({
            label: entry.label,
            value: entry.value,
            assessment: entry.assessment,
          })),
        },
        {
          kind: "refinements",
          items: refinements,
        },
        {
          kind: "next_application",
          text: nextApplication,
        },
      ],
    },
  };
}

export function updateEducationWorksheetBlank(
  inputProgress,
  {
    daySpec = {},
    blankId,
    value = "",
    now = () => new Date(),
  } = {},
) {
  const normalizedDay = normalizeEducationDaySpec(daySpec);
  const progress = ensureEducationWorksheetProgress(inputProgress, {
    daySpec: normalizedDay,
    now,
  });
  const normalizedBlankId = normalizeBlankId(blankId);
  const blank = normalizedDay.blanks.find((entry) => entry.id === normalizedBlankId);
  if (!blank) {
    return {
      didUpdate: false,
      validationError: `Unknown education worksheet blank: ${normalizedBlankId || "(empty)"}`,
      progress,
    };
  }

  const normalizedValue = trimText(value, blank.maxLength);
  if (blank.required && !normalizedValue) {
    return {
      didUpdate: false,
      validationError: "Required education worksheet blanks need a non-empty answer.",
      progress,
    };
  }

  const answeredAt = toIso(now());
  const answers = upsertAnswer(progress.answers, {
    blankId: blank.id,
    label: blank.label,
    value: normalizedValue,
    answeredAt,
  });
  const completedBlankCount = countCompletedRequiredBlanks(normalizedDay.blanks, answers);
  const totalBlankCount = normalizedDay.blanks.filter((entry) => entry.required).length;
  const allBlanksFilled = totalBlankCount > 0 && completedBlankCount === totalBlankCount;

  return {
    didUpdate: true,
    validationError: null,
    progress: {
      ...progress,
      dayId: normalizedDay.dayId,
      dayType: "education",
      dayGoal: normalizedDay.goal,
      answers,
      completedBlankCount,
      totalBlankCount,
      allBlanksFilled,
      completionReady: allBlanksFilled,
      completionConfirmed: progress.completionConfirmed === true && allBlanksFilled,
      updatedAt: answeredAt,
    },
  };
}

export function confirmEducationWorksheetCompletion(
  inputProgress,
  {
    daySpec = {},
    now = () => new Date(),
  } = {},
) {
  const normalizedDay = normalizeEducationDaySpec(daySpec);
  const progress = ensureEducationWorksheetProgress(inputProgress, {
    daySpec: normalizedDay,
    now,
  });
  const completedBlankCount = countCompletedRequiredBlanks(normalizedDay.blanks, progress.answers);
  const totalBlankCount = normalizedDay.blanks.filter((entry) => entry.required).length;
  const allBlanksFilled = totalBlankCount > 0 && completedBlankCount === totalBlankCount;

  if (!allBlanksFilled) {
    return {
      didConfirm: false,
      validationError: "Education worksheet completion requires every required blank to be filled.",
      progress: {
        ...progress,
        completedBlankCount,
        totalBlankCount,
        allBlanksFilled,
        completionReady: false,
      },
    };
  }

  const timestamp = toIso(now());
  return {
    didConfirm: true,
    validationError: null,
    progress: {
      ...progress,
      completedBlankCount,
      totalBlankCount,
      allBlanksFilled: true,
      completionReady: true,
      completionConfirmed: true,
      completedAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

export function ensureEducationWorksheetProgress(input, {
  daySpec = {},
  now = () => new Date(),
} = {}) {
  const normalizedDay = normalizeEducationDaySpec(daySpec);
  const raw = objectOrEmpty(input);
  const answers = Array.isArray(raw.answers)
    ? raw.answers.map(normalizeAnswer).filter((entry) => entry.blankId)
    : [];
  const completedBlankCount = countCompletedRequiredBlanks(normalizedDay.blanks, answers);
  const totalBlankCount = normalizedDay.blanks.filter((entry) => entry.required).length;
  const allBlanksFilled = totalBlankCount > 0 && completedBlankCount === totalBlankCount;
  const createdAt = stringOrDefault(raw.createdAt ?? raw.created_at, toIso(now()));
  const updatedAt = stringOrDefault(raw.updatedAt ?? raw.updated_at, createdAt);

  return {
    schemaVersion: EDUCATION_DAY_WORKSHEET_SCHEMA_VERSION,
    dayId: normalizeDayId(raw.dayId ?? raw.day_id ?? normalizedDay.dayId),
    dayType: "education",
    dayGoal: stringOrDefault(raw.dayGoal ?? raw.day_goal, normalizedDay.goal),
    answers: answers.sort((lhs, rhs) => lhs.blankId.localeCompare(rhs.blankId)),
    completedBlankCount,
    totalBlankCount,
    allBlanksFilled,
    completionReady: allBlanksFilled,
    completionConfirmed: raw.completionConfirmed === true && allBlanksFilled,
    createdAt,
    updatedAt,
    completedAt: stringOrDefault(raw.completedAt ?? raw.completed_at, ""),
  };
}

export function normalizeEducationDaySpec(daySpec = {}) {
  const raw = objectOrEmpty(daySpec);
  const worksheet = objectOrEmpty(raw.worksheet_spec ?? raw.worksheetSpec ?? raw.worksheet);
  const template = stringOrDefault(
    worksheet.template ?? raw.template,
    "나는 {{target_customer}}의 {{pain}}을 {{action}}으로 줄입니다.",
  );
  const blanks = normalizeBlanks(worksheet.blanks ?? raw.blanks, template);

  return {
    dayId: normalizeDayId(raw.day_id ?? raw.dayId ?? raw.day),
    title: stringOrDefault(raw.title ?? raw.day_title ?? raw.dayTitle, DEFAULT_TITLE),
    goal: stringOrDefault(raw.day_goal ?? raw.dayGoal ?? raw.goal, DEFAULT_GOAL),
    instruction: stringOrDefault(worksheet.instruction ?? raw.instruction, DEFAULT_INSTRUCTION),
    intent: stringOrDefault(worksheet.intent ?? raw.intent, DEFAULT_INTENT),
    template,
    blanks,
  };
}

function normalizeBlanks(value, template) {
  const source = Array.isArray(value) ? value : [];
  const explicit = source.map(normalizeBlank).filter((entry) => entry.id);
  const templateIds = extractTemplateBlankIds(template);
  const merged = [
    ...explicit,
    ...templateIds
      .filter((id) => !explicit.some((blank) => blank.id === id))
      .map((id) => normalizeBlank({ id })),
  ];
  if (merged.length > 0) return merged;
  return [
    normalizeBlank({ id: "target_customer", label: "타겟 고객" }),
    normalizeBlank({ id: "pain", label: "통증" }),
    normalizeBlank({ id: "action", label: "오늘 행동" }),
  ];
}

function normalizeBlank(value) {
  const raw = objectOrEmpty(value);
  const id = normalizeBlankId(raw.id ?? raw.blank_id ?? raw.blankId ?? raw.key);
  const label = stringOrDefault(raw.label ?? raw.title, humanizeBlankId(id));
  return {
    id,
    label,
    placeholder: stringOrDefault(raw.placeholder, `${label}을 적어보세요`),
    intent: stringOrDefault(raw.intent, DEFAULT_INTENT),
    required: raw.required !== false,
    maxLength: normalizePositiveInteger(raw.maxLength ?? raw.max_length, 240),
  };
}

function renderTemplateSegments(template, blanks) {
  const safeTemplate = stringOrDefault(template, "");
  const blankMap = new Map(blanks.map((blank) => [blank.id, blank]));
  const pattern = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;
  const segments = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(safeTemplate)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        text: safeTemplate.slice(lastIndex, match.index),
      });
    }
    const blankId = normalizeBlankId(match[1]);
    const blank = blankMap.get(blankId) ?? normalizeBlank({ id: blankId });
    segments.push({
      type: "blank",
      blankId: blank.id,
      label: blank.label,
      placeholder: blank.placeholder,
      value: blank.value ?? "",
      filled: Boolean(blank.value),
      required: blank.required,
    });
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < safeTemplate.length) {
    segments.push({
      type: "text",
      text: safeTemplate.slice(lastIndex),
    });
  }

  if (segments.length === 0) {
    return blanks.map((blank) => ({
      type: "blank",
      blankId: blank.id,
      label: blank.label,
      placeholder: blank.placeholder,
      value: blank.value ?? "",
      filled: Boolean(blank.value),
      required: blank.required,
    }));
  }

  return segments;
}

function extractTemplateBlankIds(template) {
  const ids = [];
  const pattern = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;
  let match;
  while ((match = pattern.exec(String(template ?? ""))) !== null) {
    const id = normalizeBlankId(match[1]);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function upsertAnswer(existing, answer) {
  return existing
    .filter((entry) => entry.blankId !== answer.blankId)
    .concat(answer)
    .sort((lhs, rhs) => lhs.blankId.localeCompare(rhs.blankId));
}

function countCompletedRequiredBlanks(blanks, answers) {
  const answerMap = new Map(answers.map((entry) => [entry.blankId, entry.value]));
  return blanks
    .filter((blank) => blank.required)
    .filter((blank) => Boolean(String(answerMap.get(blank.id) ?? "").trim()))
    .length;
}

function assessWorksheetAnswer(value) {
  const text = String(value ?? "").trim();
  if (text.length >= 12 && /[0-9가-힣a-z]/i.test(text)) return "concrete";
  if (text.length > 0) return "needs_specificity";
  return "missing";
}

function buildWorksheetFeedbackRefinements(highlights) {
  const refinements = highlights
    .filter((entry) => entry.assessment !== "concrete")
    .map((entry) => `${entry.label}을 실제 사용자 행동이나 관찰 가능한 결과로 한 번 더 좁혀보세요.`);
  if (refinements.length > 0) return refinements.slice(0, 3);
  return [
    "다음 행동에서 이 문장이 맞는지 실제 사용자 1명 또는 dogfood 로그 1개로 확인해보세요.",
  ];
}

function buildNextApplicationPrompt(daySpec, highlights) {
  const firstConcrete = highlights.find((entry) => entry.assessment === "concrete");
  const anchor = firstConcrete?.value || daySpec.goal;
  return `다음 Action Day에서는 "${anchor}"를 완료 신호로 삼아 작게 검증해보세요.`;
}

function normalizeAnswer(value) {
  const raw = objectOrEmpty(value);
  return {
    blankId: normalizeBlankId(raw.blankId ?? raw.blank_id ?? raw.id),
    label: stringOrDefault(raw.label, ""),
    value: trimText(raw.value ?? raw.answer ?? raw.text, 4000),
    answeredAt: stringOrDefault(raw.answeredAt ?? raw.answered_at, ""),
  };
}

function humanizeBlankId(id) {
  return stringOrDefault(id, "빈칸")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeBlankId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeDayId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(30, Math.max(1, Math.trunc(n)));
}

function normalizePositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function trimText(value, maxLength = 4000) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function stringOrDefault(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

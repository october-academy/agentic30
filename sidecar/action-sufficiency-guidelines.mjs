export const ACTION_SUFFICIENCY_GUIDELINE_SCHEMA_VERSION = 1;

const DEFAULT_GUIDELINE_SOURCE = "curriculum_markdown";

export function parseActionSufficiencyGuideline(markdown, {
  day,
  actionId = "",
  source = DEFAULT_GUIDELINE_SOURCE,
} = {}) {
  const text = normalizeText(markdown);
  const dayId = normalizeDayId(day);
  if (!text) {
    return emptyGuideline({ dayId, actionId, source, reason: "empty_markdown" });
  }
  if (!dayId) {
    return emptyGuideline({ dayId: null, actionId, source, reason: "missing_day" });
  }

  const block = findDayMarkdownBlock(text, dayId);
  if (!block) {
    return emptyGuideline({ dayId, actionId, source, reason: "day_not_found" });
  }

  const fields = parseStructuredFields(block.body);
  const normalizedActionId = normalizeText(actionId || fields.action_id || fields.actionId || `day-${dayId}-action`);
  const actionDescription = firstText(
    fields.action,
    fields.action_description,
    fields.actionDescription,
    fields.task,
  );
  const completionSignal = firstText(
    fields.completion_signal,
    fields.completionSignal,
    fields.signal,
    fields.completion,
  );
  const criteria = normalizeSufficiencyCriteria([
    ...collectCriteriaFromFields(fields),
    ...collectCriteriaFromSection(block.body),
  ]);
  const actionType = normalizeActionType(
    fields.action_type,
    fields.actionType,
    fields.type,
    actionDescription,
    completionSignal,
  );

  return {
    schemaVersion: ACTION_SUFFICIENCY_GUIDELINE_SCHEMA_VERSION,
    schema: "agentic30.curriculum.action_sufficiency_guideline.v1",
    source,
    dayId,
    day_id: dayId,
    actionId: normalizedActionId,
    action_id: normalizedActionId,
    actionType,
    action_type: actionType,
    goal: firstText(fields.goal, fields.day_goal, fields.dayGoal),
    keyQuestion: firstText(fields.key_question, fields.keyQuestion, fields.question),
    key_question: firstText(fields.key_question, fields.keyQuestion, fields.question),
    intent: firstText(fields.intent),
    actionDescription,
    action_description: actionDescription,
    completionSignal,
    completion_signal: completionSignal,
    sufficiencyCriteria: criteria,
    sufficiency_criteria: criteria,
    verificationMethods: normalizeVerificationMethods(fields.verification_method ?? fields.verificationMethods ?? fields.verification),
    verification_methods: normalizeVerificationMethods(fields.verification_method ?? fields.verificationMethods ?? fields.verification),
    evidenceFallback: normalizeEvidenceFallback(fields.evidence_fallback ?? fields.evidenceFallback ?? fields.fallback),
    evidence_fallback: normalizeEvidenceFallback(fields.evidence_fallback ?? fields.evidenceFallback ?? fields.fallback),
    dependencies: normalizeList(fields.dependencies ?? fields.dependency_refs ?? fields.dependencyRefs),
    dependency_refs: normalizeList(fields.dependencies ?? fields.dependency_refs ?? fields.dependencyRefs),
    structuredLineCount: countSpecLines(block.body),
    structured_line_count: countSpecLines(block.body),
    missing: missingRequiredFields({ actionDescription, completionSignal, criteria }),
  };
}

export function parseActionSufficiencyGuidelines(markdown, options = {}) {
  const text = normalizeText(markdown);
  const requestedDay = normalizeDayId(options.day);
  const blocks = requestedDay
    ? [findDayMarkdownBlock(text, requestedDay)].filter(Boolean)
    : findAllDayMarkdownBlocks(text);
  return blocks.map((block) =>
    parseActionSufficiencyGuideline(block.markdown, {
      ...options,
      day: block.dayId,
    }),
  );
}

function findDayMarkdownBlock(markdown, dayId) {
  return findAllDayMarkdownBlocks(markdown).find((block) => block.dayId === dayId) ?? null;
}

function findAllDayMarkdownBlocks(markdown) {
  const lines = normalizeText(markdown).split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s*(?:Day|DAY|일차)\s*0*(\d{1,2})(?:\b|[:.)\-\s])/);
    if (heading) {
      if (current) blocks.push(finalizeBlock(current));
      current = {
        dayId: normalizeDayId(heading[2]),
        headingLevel: heading[1].length,
        lines: [line],
      };
      continue;
    }

    if (current) {
      const nextHeading = line.match(/^(#{1,6})\s+\S/);
      if (nextHeading && nextHeading[1].length <= current.headingLevel) {
        blocks.push(finalizeBlock(current));
        current = null;
      } else {
        current.lines.push(line);
      }
    }
  }

  if (current) blocks.push(finalizeBlock(current));
  return blocks.filter((block) => block.dayId);
}

function finalizeBlock(block) {
  const markdown = block.lines.join("\n").trim();
  return {
    dayId: block.dayId,
    markdown,
    body: block.lines.slice(1).join("\n").trim(),
  };
}

function parseStructuredFields(markdown) {
  const fields = {};
  const lines = markdown.split(/\r?\n/);
  let activeKey = "";

  for (const rawLine of lines) {
    const line = rawLine.replace(/^\s*[-*]\s+/, "").trim();
    const match = line.match(/^([A-Za-z가-힣0-9 _/-]{2,40})\s*:\s*(.*)$/);
    if (!match) {
      if (activeKey && isListItemLine(line)) appendFieldValue(fields, activeKey, stripListMarker(line));
      continue;
    }
    const key = normalizeFieldKey(match[1]);
    if (!key) continue;
    const value = match[2].trim();
    activeKey = key;
    if (value) appendFieldValue(fields, key, value);
  }

  return fields;
}

function collectCriteriaFromFields(fields) {
  return [
    fields.sufficiency,
    fields.sufficiency_criteria,
    fields.action_sufficiency,
    fields.criteria,
    fields.pass_criteria,
    fields.acceptance_criteria,
  ].flatMap(splitCriteriaText);
}

function collectCriteriaFromSection(markdown) {
  const lines = markdown.split(/\r?\n/);
  const criteria = [];
  let inCriteria = false;
  let criteriaHeadingLevel = null;
  let lastCriterionIndex = -1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = line.match(/^(#{1,6})\s*(action\s+)?(sufficiency|criteria|pass criteria|acceptance criteria|충분성|완료 기준)(?=$|\s|[:：])/i);
    if (heading) {
      inCriteria = true;
      criteriaHeadingLevel = heading[1].length;
      continue;
    }
    if (inCriteria) {
      const nextHeading = line.match(/^(#{1,6})\s+\S/);
      if (nextHeading && nextHeading[1].length <= criteriaHeadingLevel) {
        break;
      }
      if (isListItemLine(line)) {
        criteria.push(stripListMarker(line));
        lastCriterionIndex = criteria.length - 1;
        continue;
      }
      if (lastCriterionIndex >= 0 && isIndentedContinuation(rawLine)) {
        criteria[lastCriterionIndex] = `${criteria[lastCriterionIndex]} ${line}`;
      }
    }
  }

  return criteria;
}

function normalizeSufficiencyCriteria(items) {
  const normalized = [];
  const seen = new Set();

  for (const item of items) {
    const text = normalizeText(item);
    if (!text) continue;
    const criterion = normalizeCriterion(text);
    const key = `${criterion.type}:${criterion.description.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(criterion);
  }

  return normalized;
}

function normalizeCriterion(text) {
  const withoutOrdinal = text.replace(/^\d+[.)]\s+/, "").trim();
  const pair = withoutOrdinal.match(/^([A-Za-z가-힣 _/-]{2,32})\s*:\s*(.+)$/);
  const label = pair ? pair[1] : "";
  const description = pair ? pair[2].trim() : withoutOrdinal;
  const type = criterionTypeFor(`${label} ${description}`);

  return {
    type,
    label: normalizeText(label),
    description,
    required: !/\b(optional|nice to have|선택)\b/i.test(description),
  };
}

function criterionTypeFor(text) {
  const value = text.toLowerCase();
  if (/^quality\b|^품질\b/.test(value)) return "quality";
  if (/^quantity\b|^수량\b/.test(value)) return "quantity";
  if (/^evidence\b|^근거\b|^증거\b/.test(value)) return "evidence";
  if (/evidence|proof|link|file|screenshot|transcript|근거|증거|링크|파일|캡처/.test(value)) return "evidence";
  if (/quantity|count|rows?|명|개|건|at least|최소|\d+/.test(value)) return "quantity";
  if (/quality|specific|named|verbatim|구체|원문|실명|품질/.test(value)) return "quality";
  if (/deadline|date|time|기한|시간/.test(value)) return "timebox";
  return "completion";
}

function splitCriteriaText(value) {
  const text = normalizeText(value);
  if (!text) return [];
  const newlineItems = text
    .split(/\n/)
    .map((item) => stripListMarker(item.trim()))
    .filter(Boolean);
  const sourceItems = newlineItems.length > 1 ? newlineItems : [text];
  return sourceItems
    .flatMap((item) => item.split(/;|\s+\|\s+/))
    .map((item) => stripListMarker(item.trim()))
    .filter(Boolean);
}

function appendFieldValue(fields, key, value) {
  const text = normalizeText(value);
  if (!text) return;
  if (fields[key]) {
    fields[key] = `${fields[key]}\n${text}`;
  } else {
    fields[key] = text;
  }
}

function isListItemLine(line) {
  return /^([-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?\S/.test(normalizeText(line));
}

function stripListMarker(line) {
  return normalizeText(line).replace(/^([-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, "").trim();
}

function isIndentedContinuation(rawLine) {
  const text = normalizeText(rawLine);
  if (!text || isListItemLine(text)) return false;
  return /^\s{2,}\S/.test(rawLine);
}

function normalizeVerificationMethods(value) {
  return normalizeList(value).map((item) => normalizeVerificationMethod(item)).filter(Boolean);
}

function normalizeVerificationMethod(value) {
  const text = normalizeText(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (!text) return "";
  if (["gws_docs_read", "google_doc", "google_docs", "docs"].includes(text)) return "google_docs";
  if (["gws_sheets_read", "google_sheet", "google_sheets", "sheets"].includes(text)) return "google_sheets";
  if (["browser_tool", "browser"].includes(text)) return "browser";
  if (["mcp", "cli"].includes(text)) return text;
  return text;
}

function normalizeEvidenceFallback(value) {
  const items = normalizeList(value);
  if (items.length === 0) return { enabled: true, acceptedTypes: ["link", "file"] };
  return {
    enabled: !items.some((item) => /^none|disabled|false$/i.test(item)),
    acceptedTypes: items.flatMap((item) => {
      const lower = item.toLowerCase();
      if (/link|url/.test(lower)) return ["link"];
      if (/file|upload|screenshot|pdf|image/.test(lower)) return ["file"];
      return [];
    }).filter((item, index, array) => array.indexOf(item) === index),
    guidance: items.join("; "),
  };
}

function normalizeActionType(...values) {
  const text = values.map(normalizeText).filter(Boolean).join(" ").toLowerCase();
  if (/sheet|tracker|rows?|스프레드시트|시트/.test(text)) return "tracker";
  if (/doc|\.md|memo|journal|script|log|research|문서|메모|일지/.test(text)) return "document";
  if (/post|landing|page|sns|thread|public|게시|랜딩/.test(text)) return "public_link";
  if (/interview|transcript|recording|인터뷰|녹음/.test(text)) return "interview_evidence";
  if (/cli|test|local|file|checklist|로컬|파일/.test(text)) return "local_artifact";
  return "custom";
}

function normalizeFieldKey(key) {
  const raw = normalizeText(key).toLowerCase();
  const canonical = raw
    .replace(/[/-]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/[?!.]+$/g, "");
  const aliases = {
    "day_goal": "goal",
    "목표": "goal",
    "핵심_질문": "key_question",
    "key_question": "key_question",
    "question": "key_question",
    "intent": "intent",
    "의도": "intent",
    "action": "action",
    "action_spec": "action",
    "action_description": "action_description",
    "completion_signal": "completion_signal",
    "완료_신호": "completion_signal",
    "완료_기준": "sufficiency_criteria",
    "sufficiency": "sufficiency",
    "sufficiency_criteria": "sufficiency_criteria",
    "action_sufficiency": "action_sufficiency",
    "criteria": "criteria",
    "pass_criteria": "pass_criteria",
    "acceptance_criteria": "acceptance_criteria",
    "verification": "verification",
    "verification_method": "verification_method",
    "verification_methods": "verification_method",
    "검증": "verification_method",
    "dependencies": "dependencies",
    "dependency_refs": "dependency_refs",
    "의존성": "dependency_refs",
    "evidence_fallback": "evidence_fallback",
    "fallback": "evidence_fallback",
    "action_type": "action_type",
    "action_id": "action_id",
  };
  return aliases[canonical] || canonical;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.flatMap(normalizeList);
  const text = normalizeText(value);
  if (!text) return [];
  return text
    .split(/\n|,|;|\s+\+\s+|\s+\|\s+|\s+or\s+/i)
    .map((item) => item.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function missingRequiredFields({ actionDescription, completionSignal, criteria }) {
  return [
    actionDescription ? "" : "action_description",
    completionSignal ? "" : "completion_signal",
    criteria.length > 0 ? "" : "sufficiency_criteria",
  ].filter(Boolean);
}

function countSpecLines(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .length;
}

function emptyGuideline({ dayId, actionId, source, reason }) {
  return {
    schemaVersion: ACTION_SUFFICIENCY_GUIDELINE_SCHEMA_VERSION,
    schema: "agentic30.curriculum.action_sufficiency_guideline.v1",
    source,
    dayId,
    day_id: dayId,
    actionId: normalizeText(actionId),
    action_id: normalizeText(actionId),
    sufficiencyCriteria: [],
    sufficiency_criteria: [],
    verificationMethods: [],
    verification_methods: [],
    evidenceFallback: { enabled: true, acceptedTypes: ["link", "file"] },
    evidence_fallback: { enabled: true, acceptedTypes: ["link", "file"] },
    dependencies: [],
    dependency_refs: [],
    missing: ["action_description", "completion_signal", "sufficiency_criteria"],
    reason,
  };
}

function normalizeDayId(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const day = Math.trunc(number);
  return day >= 1 && day <= 30 ? day : null;
}

function firstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

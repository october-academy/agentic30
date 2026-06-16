import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import { loadOfficeHoursMemory } from "./office-hours-memory.mjs";
import {
  loadCurriculumAnswerLog,
  resolveAgentic30MemoryDir,
} from "./news-market-radar.mjs";

export const ONBOARDING_MEMORY_SCHEMA_VERSION = 3;
export const ONBOARDING_MEMORY_SCHEMA = "agentic30.memory.onboarding.v3";
export const OFFICE_HOURS_TURN_LOG_SCHEMA_VERSION = 2;
export const OFFICE_HOURS_TURN_LOG_SCHEMA = "agentic30.memory.office_hours_turns.v2";
export const SOURCE_READ_LOG_SCHEMA_VERSION = 1;
export const SOURCE_READ_LOG_SCHEMA = "agentic30.memory.source_read_log.v1";
export const DAY_MEMORY_SCHEMA_VERSION = 1;
export const DAY_MEMORY_SCHEMA = "agentic30.memory.day.v1";
export const DAY_ROLLUP_SCHEMA_VERSION = 1;
export const DAY_ROLLUP_SCHEMA = "agentic30.memory.day_rollup.v1";

const MAX_TEXT = 1_000;
const MAX_LONG_TEXT = 4_000;
const MAX_SOURCES = 80;
const MAX_TURNS = 200;
const MAX_SOURCE_READS = 200;
const SENSITIVE_KEY_PATTERN = /token|secret|key|authorization|password|credential|encrypted/i;

export function resolveOnboardingMemoryPath(workspaceRoot) {
  return path.join(resolveAgentic30MemoryDir(workspaceRoot), "onboarding.json");
}

export function resolveOfficeHoursTurnLogPath(workspaceRoot) {
  return path.join(resolveAgentic30MemoryDir(workspaceRoot), "office-hours-turns.json");
}

export function resolveSourceReadLogPath(workspaceRoot) {
  return path.join(resolveAgentic30MemoryDir(workspaceRoot), "source-read-log.json");
}

export function resolveDayMemoryPath(workspaceRoot, day) {
  const dayNumber = clampInt(day, 1, 30, 1);
  return path.join(resolveAgentic30MemoryDir(workspaceRoot), "days", `day-${dayNumber}.json`);
}

export function resolveDayRollupPath(workspaceRoot) {
  return path.join(resolveAgentic30MemoryDir(workspaceRoot), "day-rollup.json");
}

export async function saveOnboardingMemory({
  workspaceRoot,
  memory,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "onboarding_memory_save");
  const normalized = normalizeOnboardingMemory({
    ...(memory && typeof memory === "object" && !Array.isArray(memory) ? memory : {}),
    workspaceRoot,
    updatedAt: now.toISOString(),
  }, { now });
  await atomicWriteJson(resolveOnboardingMemoryPath(workspaceRoot), normalized);
  return normalized;
}

export async function loadOnboardingMemory({
  workspaceRoot,
  fsImpl = fs,
  now = new Date(),
} = {}) {
  if (!workspaceRoot) return null;
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveOnboardingMemoryPath(workspaceRoot), "utf8"));
    if (raw?.schema && raw.schema !== ONBOARDING_MEMORY_SCHEMA) return null;
    return normalizeOnboardingMemory(raw, { now });
  } catch {
    return null;
  }
}

export function normalizeOnboardingMemory(value = {}, { now = new Date() } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const context = normalizeOnboardingContext(source.onboardingContext ?? source.onboarding_context ?? source.context);
  const answers = normalizeOnboardingAnswers(source.answers, context);
  const projectPath = cleanString(
    source.projectPath
      ?? source.project_path
      ?? source.workspaceRoot
      ?? source.workspace_root
      ?? context.projectPath,
    MAX_TEXT,
  );
  return {
    schemaVersion: ONBOARDING_MEMORY_SCHEMA_VERSION,
    schema: ONBOARDING_MEMORY_SCHEMA,
    workspaceRoot: projectPath,
    projectPath,
    answers,
    onboardingContext: context.payload,
    readSources: normalizeReadSources(source.readSources ?? source.read_sources ?? source.sources),
    createdAt: normalizeIsoDate(source.createdAt ?? source.created_at, now),
    updatedAt: normalizeIsoDate(source.updatedAt ?? source.updated_at, now),
  };
}

export async function appendOfficeHoursTurn({
  workspaceRoot,
  turn,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "office_hours_turn_append");
  const filePath = resolveOfficeHoursTurnLogPath(workspaceRoot);
  const normalizedTurn = normalizeOfficeHoursTurn(turn, { now });
  if (!normalizedTurn) {
    throw new Error("appendOfficeHoursTurn requires question and answer text.");
  }
  return withFileLock(filePath, async () => {
    const previous = await loadOfficeHoursTurnLog({ workspaceRoot, now, prune: false });
    const turns = [...previous.turns, normalizedTurn].slice(-MAX_TURNS);
    const payload = {
      schemaVersion: OFFICE_HOURS_TURN_LOG_SCHEMA_VERSION,
      schema: OFFICE_HOURS_TURN_LOG_SCHEMA,
      updatedAt: now.toISOString(),
      turns,
    };
    await atomicWriteJson(filePath, payload);
    if (normalizedTurn.day) {
      await refreshDayMemory({ workspaceRoot, day: normalizedTurn.day, now }).catch(() => {});
    }
    return payload;
  });
}

export async function reviseOfficeHoursTurn({
  workspaceRoot,
  requestId,
  sessionId = "",
  replacementTurn,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "office_hours_turn_revise");
  const targetRequestId = cleanString(requestId, 180);
  if (!targetRequestId) {
    throw new Error("reviseOfficeHoursTurn requires requestId.");
  }
  const normalizedTurn = normalizeOfficeHoursTurn(replacementTurn, { now });
  if (!normalizedTurn) {
    throw new Error("reviseOfficeHoursTurn requires replacement question and answer text.");
  }
  const filePath = resolveOfficeHoursTurnLogPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const previous = await loadOfficeHoursTurnLog({ workspaceRoot, now, prune: false });
    const turns = Array.isArray(previous.turns) ? previous.turns : [];
    const targetIndex = turns.findIndex((turn) =>
      turn.requestId === targetRequestId
        && (!sessionId || turn.sessionId === sessionId));
    if (targetIndex < 0) {
      throw new Error("No editable Office Hours answer found for this request.");
    }
    const target = turns[targetIndex];
    if (!target.promptSnapshot) {
      throw new Error("This Office Hours answer was saved before editable snapshots existed.");
    }
    const targetDay = clampInt(target.day, 1, 400, null);
    const replacement = {
      ...normalizedTurn,
      id: target.id,
      occurredAt: target.occurredAt,
      revisedAt: now.toISOString(),
    };
    const nextTurns = [];
    for (let index = 0; index < turns.length; index += 1) {
      const turn = turns[index];
      if (index < targetIndex) {
        nextTurns.push(turn);
        continue;
      }
      if (index === targetIndex) {
        nextTurns.push(replacement);
        continue;
      }
      const sameDay = targetDay && clampInt(turn.day, 1, 400, null) === targetDay;
      if (sameDay) continue;
      nextTurns.push(turn);
    }
    const payload = {
      schemaVersion: OFFICE_HOURS_TURN_LOG_SCHEMA_VERSION,
      schema: OFFICE_HOURS_TURN_LOG_SCHEMA,
      updatedAt: now.toISOString(),
      turns: nextTurns.slice(-MAX_TURNS),
    };
    await atomicWriteJson(filePath, payload);
    if (targetDay) {
      await refreshDayMemory({ workspaceRoot, day: targetDay, now }).catch(() => {});
    }
    return {
      previous,
      payload,
      target,
      replacement,
      removedTurns: turns.slice(targetIndex + 1).filter((turn) =>
        targetDay && clampInt(turn.day, 1, 400, null) === targetDay),
    };
  });
}

export async function loadOfficeHoursTurnLog({
  workspaceRoot,
  fsImpl = fs,
  now = new Date(),
} = {}) {
  if (!workspaceRoot) {
    return makeOfficeHoursTurnLog({ now });
  }
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveOfficeHoursTurnLogPath(workspaceRoot), "utf8"));
    const turns = Array.isArray(raw?.turns)
      ? raw.turns.map((turn) => normalizeOfficeHoursTurn(turn, { now })).filter(Boolean)
      : [];
    return {
      schemaVersion: OFFICE_HOURS_TURN_LOG_SCHEMA_VERSION,
      schema: OFFICE_HOURS_TURN_LOG_SCHEMA,
      updatedAt: normalizeIsoDate(raw?.updatedAt ?? raw?.updated_at, now),
      turns: turns.slice(-MAX_TURNS),
    };
  } catch {
    return makeOfficeHoursTurnLog({ now });
  }
}

export async function appendSourceReadLog({
  workspaceRoot,
  entry,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "source_read_log_append");
  const filePath = resolveSourceReadLogPath(workspaceRoot);
  const normalizedEntry = normalizeSourceReadEntry(entry, { now });
  if (!normalizedEntry) {
    throw new Error("appendSourceReadLog requires sourceId or tool.");
  }
  return withFileLock(filePath, async () => {
    const previous = await loadSourceReadLog({ workspaceRoot, now });
    const reads = [...previous.reads, normalizedEntry].slice(-MAX_SOURCE_READS);
    const payload = {
      schemaVersion: SOURCE_READ_LOG_SCHEMA_VERSION,
      schema: SOURCE_READ_LOG_SCHEMA,
      updatedAt: now.toISOString(),
      reads,
    };
    await atomicWriteJson(filePath, payload);
    return payload;
  });
}

export async function loadSourceReadLog({
  workspaceRoot,
  fsImpl = fs,
  now = new Date(),
} = {}) {
  if (!workspaceRoot) {
    return makeSourceReadLog({ now });
  }
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveSourceReadLogPath(workspaceRoot), "utf8"));
    const reads = Array.isArray(raw?.reads)
      ? raw.reads.map((entry) => normalizeSourceReadEntry(entry, { now })).filter(Boolean)
      : [];
    return {
      schemaVersion: SOURCE_READ_LOG_SCHEMA_VERSION,
      schema: SOURCE_READ_LOG_SCHEMA,
      updatedAt: normalizeIsoDate(raw?.updatedAt ?? raw?.updated_at, now),
      reads: reads.slice(-MAX_SOURCE_READS),
    };
  } catch {
    return makeSourceReadLog({ now });
  }
}

export async function loadDayMemory({
  workspaceRoot,
  day,
  fsImpl = fs,
  now = new Date(),
} = {}) {
  const dayNumber = clampInt(day, 1, 30, null);
  if (!workspaceRoot || !dayNumber) return null;
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveDayMemoryPath(workspaceRoot, dayNumber), "utf8"));
    return normalizeDayMemory(raw, { now });
  } catch {
    return null;
  }
}

export async function loadDayRollup({
  workspaceRoot,
  fsImpl = fs,
  now = new Date(),
} = {}) {
  if (!workspaceRoot) return null;
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveDayRollupPath(workspaceRoot), "utf8"));
    const days = Array.isArray(raw?.days)
      ? raw.days.map((entry) => normalizeDayRollupEntry(entry)).filter(Boolean)
      : [];
    return {
      schemaVersion: DAY_ROLLUP_SCHEMA_VERSION,
      schema: DAY_ROLLUP_SCHEMA,
      updatedAt: normalizeIsoDate(raw?.updatedAt ?? raw?.updated_at, now),
      throughDay: clampInt(raw?.throughDay ?? raw?.through_day, 1, 30, days.at(-1)?.day ?? null),
      days,
      cumulative: normalizeDayRollupCumulative(raw?.cumulative, days),
    };
  } catch {
    return null;
  }
}

export async function refreshDayMemory({
  workspaceRoot,
  day,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "day_memory_refresh");
  const dayNumber = clampInt(day, 1, 30, null);
  if (!dayNumber) throw new Error("day_memory_refresh: day must be 1-30.");
  const [answerLog, turnLog, ledger, sourceReadLog] = await Promise.all([
    loadCurriculumAnswerLog({ workspaceRoot, now }).catch(() => ({ records: [] })),
    loadOfficeHoursTurnLog({ workspaceRoot, now }).catch(() => makeOfficeHoursTurnLog({ now })),
    loadOfficeHoursMemory({ workspaceRoot, now }).catch(() => null),
    loadSourceReadLog({ workspaceRoot, now }).catch(() => makeSourceReadLog({ now })),
  ]);
  const commitments = Array.isArray(ledger?.commitments) ? ledger.commitments : [];
  const dayMemory = buildDayMemoryPayload({
    workspaceRoot,
    day: dayNumber,
    curriculumRecords: answerLog.records || [],
    officeHoursTurns: turnLog.turns || [],
    commitments,
    sourceReads: sourceReadLog.reads || [],
    now,
  });
  await atomicWriteJson(resolveDayMemoryPath(workspaceRoot, dayNumber), dayMemory);
  const rollup = await refreshDayRollup({
    workspaceRoot,
    targetDay: dayNumber,
    curriculumRecords: answerLog.records || [],
    officeHoursTurns: turnLog.turns || [],
    commitments,
    now,
  });
  return { dayMemory, rollup };
}

export async function refreshDayRollup({
  workspaceRoot,
  targetDay = null,
  curriculumRecords = null,
  officeHoursTurns = null,
  commitments = null,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "day_rollup_refresh");
  const [answerLog, turnLog, ledger] = await Promise.all([
    curriculumRecords ? Promise.resolve({ records: curriculumRecords }) : loadCurriculumAnswerLog({ workspaceRoot, now }).catch(() => ({ records: [] })),
    officeHoursTurns ? Promise.resolve({ turns: officeHoursTurns }) : loadOfficeHoursTurnLog({ workspaceRoot, now }).catch(() => makeOfficeHoursTurnLog({ now })),
    commitments ? Promise.resolve({ commitments }) : loadOfficeHoursMemory({ workspaceRoot, now }).catch(() => null),
  ]);
  const entries = buildDayRollup({
    targetDay,
    curriculumRecords: answerLog.records || [],
    officeHoursTurns: turnLog.turns || [],
    commitments: Array.isArray(ledger?.commitments) ? ledger.commitments : [],
  }).map((entry) => ({
    ...entry,
    detailPath: `.agentic30/memory/days/day-${entry.day}.json`,
  }));
  const payload = {
    schemaVersion: DAY_ROLLUP_SCHEMA_VERSION,
    schema: DAY_ROLLUP_SCHEMA,
    updatedAt: now.toISOString(),
    throughDay: entries.at(-1)?.day ?? clampInt(targetDay, 1, 30, null),
    days: entries,
    cumulative: normalizeDayRollupCumulative(null, entries),
  };
  await atomicWriteJson(resolveDayRollupPath(workspaceRoot), payload);
  return payload;
}

export async function buildOfficeHoursHistorySummary({
  workspaceRoot,
  day = null,
  now = new Date(),
} = {}) {
  if (!workspaceRoot) return null;
  const targetDay = clampInt(day, 1, 400, null);
  const [onboarding, answerLog, turnLog, ledger, sourceReadLog] = await Promise.all([
    loadOnboardingMemory({ workspaceRoot, now }).catch(() => null),
    loadCurriculumAnswerLog({ workspaceRoot, now }).catch(() => ({ records: [] })),
    loadOfficeHoursTurnLog({ workspaceRoot, now }).catch(() => makeOfficeHoursTurnLog({ now })),
    loadOfficeHoursMemory({ workspaceRoot, now }).catch(() => null),
    loadSourceReadLog({ workspaceRoot, now }).catch(() => makeSourceReadLog({ now })),
  ]);
  const [persistedRollup, currentDayMemory] = await Promise.all([
    loadDayRollup({ workspaceRoot, now }).catch(() => null),
    targetDay ? loadDayMemory({ workspaceRoot, day: targetDay, now }).catch(() => null) : Promise.resolve(null),
  ]);
  const curriculumAnswers = (answerLog.records || [])
    .filter((record) => !targetDay || clampInt(record.day, 1, 400, 0) <= targetDay)
    .slice(-12)
    .map(formatCurriculumAnswerForHistory)
    .filter(Boolean);
  const officeHoursTurns = (turnLog.turns || [])
    .filter((turn) => !targetDay || clampInt(turn.day, 1, 400, targetDay) <= targetDay)
    .slice(-12)
    .map(formatOfficeHoursTurnForHistory)
    .filter(Boolean);
  const commitments = Array.isArray(ledger?.commitments) ? ledger.commitments : [];
  const openCommitments = commitments
    .filter((commitment) => !commitment?.evidence && ["open", "missed", "abandoned"].includes(commitment?.status || "open"))
    .slice(-8)
    .map(formatCommitmentForHistory)
    .filter(Boolean);
  const metCommitments = commitments
    .filter((commitment) => commitment?.evidence || commitment?.status === "met")
    .slice(-5)
    .map(formatCommitmentForHistory)
    .filter(Boolean);
  const sourceReads = (sourceReadLog.reads || [])
    .slice(-8)
    .map(formatSourceReadForHistory)
    .filter(Boolean);
  const dayRollup = (persistedRollup?.days?.length ? persistedRollup.days : buildDayRollup({
    targetDay,
    curriculumRecords: answerLog.records || [],
    officeHoursTurns: turnLog.turns || [],
    commitments,
  })).filter((entry) => !targetDay || clampInt(entry.day, 1, 30, 0) <= targetDay);
  return {
    schemaVersion: 1,
    day: targetDay,
    onboarding: summarizeOnboardingForHistory(onboarding),
    dayRollup,
    currentDayMemory,
    curriculumAnswers,
    officeHoursTurns,
    openCommitments,
    metCommitments,
    sourceReads,
    counts: {
      readSources: onboarding?.readSources?.length || 0,
      dayRollup: dayRollup.length,
      currentDayDetailRecords: currentDayMemory?.details?.totalRecords || 0,
      curriculumAnswers: curriculumAnswers.length,
      officeHoursTurns: officeHoursTurns.length,
      openCommitments: openCommitments.length,
      metCommitments: metCommitments.length,
      sourceReads: sourceReads.length,
    },
  };
}

export function formatOfficeHoursHistoryForPrompt(history) {
  if (!history || typeof history !== "object") return "";
  const lines = [
    "[Agentic30 Memory — .agentic30/memory]",
    "Memory map: onboarding=.agentic30/memory/onboarding.json, rollup=.agentic30/memory/day-rollup.json, day detail=.agentic30/memory/days/day-N.json, live Q&A=.agentic30/memory/office-hours-turns.json, commitments=.agentic30/memory/office-hours-ledger.json.",
    "탐색 순서: 1) day-rollup으로 Day 1..N 누적 요약을 훑는다. 2) open/missed/evidence=0인 day를 우선한다. 3) 필요한 day-N 상세의 질문/답변/약속만 참조한다. 4) 최근 상세를 제외하고는 요약을 우선해 prompt budget을 아낀다.",
  ];
  const onboarding = history.onboarding || {};
  if (onboarding.summary) lines.push(`온보딩: ${onboarding.summary}`);
  if (Array.isArray(onboarding.readSources) && onboarding.readSources.length) {
    lines.push(`읽을 기록: ${onboarding.readSources.join(" / ")}`);
  }
  if (Array.isArray(history.openCommitments) && history.openCommitments.length) {
    lines.push("미해결 약속:");
    for (const item of history.openCommitments.slice(0, 5)) lines.push(`- ${item}`);
  }
  if (Array.isArray(history.dayRollup) && history.dayRollup.length) {
    lines.push("이전 Day 압축 기억:");
    for (const item of history.dayRollup) {
      const day = item.day ? `Day ${item.day}` : "Day ?";
      const status = item.openCommitments > 0 ? `open=${item.openCommitments}` : "open=0";
      const evidence = item.metCommitments > 0 ? `evidence=${item.metCommitments}` : "evidence=0";
      const detailPath = item.detailPath ? ` detail=${item.detailPath}` : "";
      lines.push(`- ${day}: ${item.summary} (${status}, ${evidence})${detailPath}`);
    }
  }
  if (history.currentDayMemory?.summary?.text) {
    lines.push(`현재 Day 상세 요약: ${history.currentDayMemory.summary.text}`);
  }
  if (Array.isArray(history.curriculumAnswers) && history.curriculumAnswers.length) {
    lines.push("Day 인터뷰 질문/답변:");
    for (const item of history.curriculumAnswers.slice(-6)) lines.push(`- ${item}`);
  }
  if (Array.isArray(history.officeHoursTurns) && history.officeHoursTurns.length) {
    lines.push("Office Hours 질문/답변:");
    for (const item of history.officeHoursTurns.slice(-6)) lines.push(`- ${item}`);
  }
  if (Array.isArray(history.sourceReads) && history.sourceReads.length) {
    lines.push("최근 읽은 기록:");
    for (const item of history.sourceReads.slice(-4)) lines.push(`- ${item}`);
  }
  lines.push("질문 규칙: 같은 질문을 그대로 반복하지 말고, 미해결 약속/없는 증거/읽을 수 있는 기록을 기준으로 다음 확인 질문을 만든다.");
  return lines.join("\n");
}

function normalizeOnboardingContext(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const payload = redactSensitiveObject({
    business_description: cleanString(source.business_description ?? source.businessDescription, MAX_LONG_TEXT),
    current_stage: cleanString(source.current_stage ?? source.currentStage, MAX_LONG_TEXT),
    goal: cleanString(source.goal, MAX_LONG_TEXT),
    custom_work_mode: cleanString(source.custom_work_mode ?? source.customWorkMode, MAX_TEXT),
    work_mode: cleanString(source.work_mode ?? source.workMode, MAX_TEXT),
    focus_area: cleanString(source.focus_area ?? source.focusArea, MAX_TEXT),
    product_bottleneck: cleanString(source.product_bottleneck ?? source.productBottleneck, MAX_TEXT),
    isolation_level: cleanString(source.isolation_level ?? source.isolationLevel, MAX_TEXT),
    isolation_levels: normalizeStringArray(source.isolation_levels ?? source.isolationLevels, 20, MAX_TEXT),
    completed_at: cleanString(source.completed_at ?? source.completedAt, MAX_TEXT),
  });
  return {
    payload,
    projectPath: cleanString(source.project_path ?? source.projectPath ?? source.workspaceRoot, MAX_TEXT),
  };
}

function normalizeOnboardingAnswers(value = {}, context = { payload: {} }) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const payload = context.payload || {};
  return {
    timeBudget: normalizeAnswer(
      source.timeBudget ?? source.time_budget,
      "time_budget",
      "하루에 얼마나 시간을 쓸 수 있는지",
      payload.custom_work_mode || payload.work_mode,
    ),
    primaryFocus: normalizeAnswer(
      source.primaryFocus ?? source.primary_focus,
      "primary_focus",
      "요즘 어디에 시간을 가장 많이 쓰고 있나요?",
      payload.focus_area,
    ),
    primaryBottleneck: normalizeAnswer(
      source.primaryBottleneck ?? source.primary_bottleneck,
      "primary_bottleneck",
      "지금 제품을 만들거나 키우는 과정에서 가장 큰 병목은 어디인가요?",
      payload.product_bottleneck,
    ),
    existingRecords: normalizeAnswer(
      source.existingRecords ?? source.existing_records,
      "existing_records",
      "이미 가진 기록",
      normalizeStringArray(payload.isolation_levels, 20, MAX_TEXT).join(", "),
    ),
  };
}

function normalizeAnswer(value, id, question, fallback = "") {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const answer = cleanString(source.answer ?? source.value ?? source.title ?? fallback, MAX_LONG_TEXT);
  return {
    id,
    question,
    answer,
    detail: cleanString(source.detail ?? source.description, MAX_LONG_TEXT),
  };
}

function normalizeReadSources(values = []) {
  const items = Array.isArray(values) ? values : [values];
  return items
    .map((item) => {
      const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      const id = cleanString(source.id ?? source.sourceId ?? source.source_id, 120);
      if (!id) return null;
      return redactSensitiveObject({
        id,
        displayName: cleanString(source.displayName ?? source.display_name ?? source.name, 200),
        category: cleanString(source.category, 120),
        kind: cleanString(source.kind, 160),
        status: cleanString(source.status, 120),
        path: cleanString(source.path ?? source.url, MAX_LONG_TEXT),
        detail: cleanString(source.detail, MAX_LONG_TEXT),
      });
    })
    .filter(Boolean)
    .slice(0, MAX_SOURCES);
}

function normalizeOfficeHoursTurn(value = {}, { now = new Date() } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const questionText = cleanString(source.questionText ?? source.question_text ?? source.question, MAX_LONG_TEXT);
  const responseText = cleanString(source.responseText ?? source.response_text ?? source.answer, MAX_LONG_TEXT);
  if (!questionText || !responseText) return null;
  const day = clampInt(source.day ?? source.officeHoursDay ?? source.office_hours_day, 1, 400, null);
  const occurredAt = normalizeIsoDate(source.occurredAt ?? source.occurred_at ?? source.createdAt, now);
  const promptSnapshot = normalizeStructuredPromptSnapshot(source.promptSnapshot ?? source.prompt_snapshot, { now });
  const submissions = normalizeStructuredPromptSubmissions(source.submissions ?? source.responses);
  const revisedAt = source.revisedAt ?? source.revised_at;
  return {
    id: cleanString(source.id ?? `oh-${day || "x"}-${Date.parse(occurredAt) || now.getTime()}`, 180),
    day,
    sessionId: cleanString(source.sessionId ?? source.session_id, 160),
    requestId: cleanString(source.requestId ?? source.request_id, 160),
    mode: cleanString(source.mode, 120),
    signalId: cleanString(source.signalId ?? source.signal_id, 120),
    signalLabel: cleanString(source.signalLabel ?? source.signal_label, 160),
    questionText,
    responseText,
    responseDescription: cleanString(source.responseDescription ?? source.response_description, MAX_LONG_TEXT),
    ...(promptSnapshot ? { promptSnapshot } : {}),
    ...(submissions.length ? { submissions } : {}),
    // Marks the 대안 비교 closing-card answer — the interview-completion
    // signal the incomplete-interview gate honors even when fewer answers
    // than the expected count were recorded (smart-skip interviews).
    ...(source.terminal === true ? { terminal: true } : {}),
    ...(revisedAt ? { revisedAt: normalizeIsoDate(revisedAt, now) } : {}),
    occurredAt,
  };
}

function normalizeStructuredPromptSnapshot(value = {}, { now = new Date() } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) return null;
  const questions = Array.isArray(source.questions)
    ? source.questions.map(normalizeStructuredPromptQuestion).filter(Boolean)
    : [];
  if (!questions.length) return null;
  const requestId = cleanString(source.requestId ?? source.request_id, 180);
  const sessionId = cleanString(source.sessionId ?? source.session_id, 160);
  const toolName = cleanString(source.toolName ?? source.tool_name, 160);
  if (!requestId || !sessionId || !toolName) return null;
  return {
    requestId,
    sessionId,
    toolName,
    title: nullableCleanString(source.title, 240),
    createdAt: normalizeIsoDate(source.createdAt ?? source.created_at, now),
    ...(normalizeStructuredPromptIntro(source.intro) ? { intro: normalizeStructuredPromptIntro(source.intro) } : {}),
    ...(normalizeStructuredPromptResources(source.resources).length ? { resources: normalizeStructuredPromptResources(source.resources) } : {}),
    questions,
    ...(normalizeStructuredPromptGeneration(source.generation) ? { generation: normalizeStructuredPromptGeneration(source.generation) } : {}),
  };
}

function normalizeStructuredPromptQuestion(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) return null;
  const question = cleanString(source.question, MAX_LONG_TEXT);
  if (!question) return null;
  const output = {
    ...(nullableCleanString(source.questionId ?? source.question_id ?? source.id, 240) ? { questionId: nullableCleanString(source.questionId ?? source.question_id ?? source.id, 240) } : {}),
    header: cleanString(source.header, 240) || "질문",
    question,
    ...(nullableCleanString(source.helperText ?? source.helper_text, MAX_LONG_TEXT) ? { helperText: nullableCleanString(source.helperText ?? source.helper_text, MAX_LONG_TEXT) } : {}),
    ...(normalizeStringList(source.highlightPhrases ?? source.highlight_phrases ?? source.highlights ?? source.highlight, 12, 240).length ? { highlightPhrases: normalizeStringList(source.highlightPhrases ?? source.highlight_phrases ?? source.highlights ?? source.highlight, 12, 240) } : {}),
    ...(normalizeEmphasisList(source.emphasis ?? source.emphasis_spans).length ? { emphasis: normalizeEmphasisList(source.emphasis ?? source.emphasis_spans) } : {}),
    ...(normalizeStructuredPromptOptions(source.options).length ? { options: normalizeStructuredPromptOptions(source.options) } : {}),
    ...(typeof source.multiSelect === "boolean" ? { multiSelect: source.multiSelect } : {}),
    ...(typeof source.allowFreeText === "boolean" ? { allowFreeText: source.allowFreeText } : {}),
    ...(typeof source.requiresFreeText === "boolean" ? { requiresFreeText: source.requiresFreeText } : {}),
    ...(nullableCleanString(source.freeTextPlaceholder ?? source.free_text_placeholder, 400) ? { freeTextPlaceholder: nullableCleanString(source.freeTextPlaceholder ?? source.free_text_placeholder, 400) } : {}),
    ...(nullableCleanString(source.textMode ?? source.text_mode, 40) ? { textMode: nullableCleanString(source.textMode ?? source.text_mode, 40) } : {}),
  };
  return output;
}

function normalizeStructuredPromptOptions(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      const label = cleanString(source.label, 400);
      if (!label) return null;
      return {
        label,
        description: cleanString(source.description, MAX_LONG_TEXT),
        ...(nullableCleanString(source.preview, MAX_LONG_TEXT) ? { preview: nullableCleanString(source.preview, MAX_LONG_TEXT) } : {}),
        ...(nullableCleanString(source.nextIntent ?? source.next_intent, 240) ? { nextIntent: nullableCleanString(source.nextIntent ?? source.next_intent, 240) } : {}),
        ...(typeof source.recommended === "boolean" ? { recommended: source.recommended } : {}),
        ...(nullableCleanString(source.risk, MAX_LONG_TEXT) ? { risk: nullableCleanString(source.risk, MAX_LONG_TEXT) } : {}),
        ...(nullableCleanString(source.evidenceTarget ?? source.evidence_target, MAX_LONG_TEXT) ? { evidenceTarget: nullableCleanString(source.evidenceTarget ?? source.evidence_target, MAX_LONG_TEXT) } : {}),
        ...(nullableCleanString(source.mapsTo ?? source.maps_to, 240) ? { mapsTo: nullableCleanString(source.mapsTo ?? source.maps_to, 240) } : {}),
        ...(nullableCleanString(source.failureMode ?? source.failure_mode, MAX_LONG_TEXT) ? { failureMode: nullableCleanString(source.failureMode ?? source.failure_mode, MAX_LONG_TEXT) } : {}),
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeStructuredPromptIntro(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) return null;
  const intro = {
    ...(nullableCleanString(source.title, 240) ? { title: nullableCleanString(source.title, 240) } : {}),
    ...(nullableCleanString(source.body, MAX_LONG_TEXT) ? { body: nullableCleanString(source.body, MAX_LONG_TEXT) } : {}),
    ...(normalizeStringList(source.bullets, 8, 400).length ? { bullets: normalizeStringList(source.bullets, 8, 400) } : {}),
  };
  return Object.keys(intro).length ? intro : null;
}

function normalizeStructuredPromptResources(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      const title = cleanString(source.title, 240);
      const url = cleanString(source.url, MAX_LONG_TEXT);
      if (!title || !url) return null;
      return {
        title,
        ...(nullableCleanString(source.source, 240) ? { source: nullableCleanString(source.source, 240) } : {}),
        url,
        ...(nullableCleanString(source.description, MAX_LONG_TEXT) ? { description: nullableCleanString(source.description, MAX_LONG_TEXT) } : {}),
      };
    })
    .filter(Boolean)
    .slice(0, 5);
}

function normalizeStructuredPromptGeneration(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) return null;
  const generation = {
    ...(nullableCleanString(source.mode, 160) ? { mode: nullableCleanString(source.mode, 160) } : {}),
    ...(nullableCleanString(source.docType ?? source.doc_type, 160) ? { docType: nullableCleanString(source.docType ?? source.doc_type, 160) } : {}),
    ...(nullableCleanString(source.signalId ?? source.signal_id, 160) ? { signalId: nullableCleanString(source.signalId ?? source.signal_id, 160) } : {}),
    ...(nullableCleanString(source.signalLabel ?? source.signal_label, 240) ? { signalLabel: nullableCleanString(source.signalLabel ?? source.signal_label, 240) } : {}),
    ...(typeof source.isLastSignalForDoc === "boolean" ? { isLastSignalForDoc: source.isLastSignalForDoc } : {}),
    ...(typeof source.dimensionTransitioned === "boolean" ? { dimensionTransitioned: source.dimensionTransitioned } : {}),
    ...(nullableCleanString(source.previousSignalLabel ?? source.previous_signal_label, 240) ? { previousSignalLabel: nullableCleanString(source.previousSignalLabel ?? source.previous_signal_label, 240) } : {}),
    ...(nullableCleanString(source.previousAnswerLabel ?? source.previous_answer_label, 240) ? { previousAnswerLabel: nullableCleanString(source.previousAnswerLabel ?? source.previous_answer_label, 240) } : {}),
    ...(clampInt(source.dimensionStepIndex ?? source.dimension_step_index, 1, 100, null) ? { dimensionStepIndex: clampInt(source.dimensionStepIndex ?? source.dimension_step_index, 1, 100, null) } : {}),
    ...(clampInt(source.dimensionTotal ?? source.dimension_total, 1, 100, null) ? { dimensionTotal: clampInt(source.dimensionTotal ?? source.dimension_total, 1, 100, null) } : {}),
  };
  return Object.keys(generation).length ? generation : null;
}

function normalizeStructuredPromptSubmissions(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      const question = cleanString(source.question, MAX_LONG_TEXT);
      const selectedOptions = normalizeStringList(source.selectedOptions ?? source.selected_options, 12, 400);
      const freeText = cleanString(source.freeText ?? source.free_text, MAX_LONG_TEXT);
      if (!question && !selectedOptions.length && !freeText) return null;
      return { question, selectedOptions, freeText };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeStringList(value, maxItems = 12, maxLength = MAX_TEXT) {
  const items = Array.isArray(value) ? value : (typeof value === "string" ? [value] : []);
  return items
    .map((item) => cleanString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeEmphasisList(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      const phrase = cleanString(source.phrase ?? source.text, 400);
      if (!phrase) return null;
      const style = cleanString(source.style ?? source.kind, 40).toLowerCase();
      return {
        phrase,
        style: ["strong", "mark", "code"].includes(style) ? style : "mark",
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeSourceReadEntry(value = {}, { now = new Date() } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sourceId = cleanString(source.sourceId ?? source.source_id ?? source.id, 160);
  const tool = cleanString(source.tool, 160);
  if (!sourceId && !tool) return null;
  const readAt = normalizeIsoDate(source.readAt ?? source.read_at ?? source.createdAt, now);
  return redactSensitiveObject({
    id: cleanString(source.id ?? `sr-${sourceId || tool}-${Date.parse(readAt) || now.getTime()}`, 180),
    sourceId,
    tool,
    path: cleanString(source.path ?? source.url, MAX_LONG_TEXT),
    domain: cleanString(source.domain, 240),
    summary: cleanString(source.summary, MAX_LONG_TEXT),
    fingerprint: cleanString(source.fingerprint, 240),
    readAt,
  });
}

function makeOfficeHoursTurnLog({ now = new Date() } = {}) {
  return {
    schemaVersion: OFFICE_HOURS_TURN_LOG_SCHEMA_VERSION,
    schema: OFFICE_HOURS_TURN_LOG_SCHEMA,
    updatedAt: now.toISOString(),
    turns: [],
  };
}

function makeSourceReadLog({ now = new Date() } = {}) {
  return {
    schemaVersion: SOURCE_READ_LOG_SCHEMA_VERSION,
    schema: SOURCE_READ_LOG_SCHEMA,
    updatedAt: now.toISOString(),
    reads: [],
  };
}

function summarizeOnboardingForHistory(onboarding) {
  if (!onboarding) return null;
  const answers = onboarding.answers || {};
  const focusArea = answers.primaryFocus?.answer || onboarding.onboardingContext?.focus_area || "";
  const timeBudget = answers.timeBudget?.answer || onboarding.onboardingContext?.custom_work_mode || onboarding.onboardingContext?.work_mode || "";
  const blocker = answers.primaryBottleneck?.answer || onboarding.onboardingContext?.product_bottleneck || "";
  const records = answers.existingRecords?.answer || normalizeStringArray(onboarding.onboardingContext?.isolation_levels).join(", ");
  const projectPath = onboarding.projectPath || "";
  const readSources = (onboarding.readSources || [])
    .map((source) => {
      const label = source.displayName || source.id;
      const status = source.status ? `:${source.status}` : "";
      const location = source.path ? ` ${source.path}` : "";
      return cleanString(`${label}${status}${location}`, 260);
    })
    .filter(Boolean)
    .slice(0, 12);
  const summary = [
    focusArea ? `집중영역=${focusArea}` : "",
    timeBudget ? `시간=${timeBudget}` : "",
    blocker ? `막힘=${blocker}` : "",
    records ? `기록=${records}` : "",
    projectPath ? `프로젝트=${projectPath}` : "",
  ].filter(Boolean).join(" · ");
  return { focusArea, timeBudget, blocker, records, projectPath, readSources, summary };
}

function formatCurriculumAnswerForHistory(record) {
  if (!record) return "";
  const question = cleanString(record.questionTitle || record.questionPrompt || record.questionId, 260);
  const answer = cleanString(record.answerTitle || record.freeformAnswer || record.answerDetail, 320);
  if (!question && !answer) return "";
  return `Day ${record.day}: Q=${question || "질문 미기록"} / A=${answer || "답변 미기록"}`;
}

function formatOfficeHoursTurnForHistory(turn) {
  if (!turn) return "";
  const day = turn.day ? `Day ${turn.day}` : "Day ?";
  return `${day}: Q=${cleanString(turn.questionText, 260)} / A=${cleanString(turn.responseText, 320)}`;
}

function formatCommitmentForHistory(commitment) {
  if (!commitment) return "";
  const day = commitment.createdDay || commitment.day || commitment.cycle || "?";
  const status = commitment.status || "open";
  const text = cleanString(commitment.text || commitment.message, 300);
  const evidence = commitment.evidence?.url || commitment.evidence?.note || "";
  return `Day ${day} [${status}] ${text}${evidence ? ` evidence=${cleanString(evidence, 180)}` : ""}`;
}

function formatSourceReadForHistory(entry) {
  if (!entry) return "";
  return `${entry.sourceId || entry.tool}: ${entry.summary || entry.path || entry.domain || "read"}`;
}

function buildDayMemoryPayload({
  workspaceRoot,
  day,
  curriculumRecords = [],
  officeHoursTurns = [],
  commitments = [],
  sourceReads = [],
  now = new Date(),
} = {}) {
  const dayNumber = clampInt(day, 1, 30, 1);
  const dayAnswers = curriculumRecords
    .filter((record) => clampInt(record.day, 1, 30, null) === dayNumber)
    .map((record) => ({
      id: record.id,
      questionId: record.questionId,
      dimension: record.dimension,
      questionTitle: record.questionTitle,
      questionPrompt: record.questionPrompt,
      answerId: record.answerId,
      answerTitle: record.answerTitle,
      answerDetail: record.answerDetail,
      freeformAnswer: record.freeformAnswer,
      isAntiSignal: Boolean(record.isAntiSignal),
      occurredAt: record.occurredAt,
    }));
  const dayTurns = officeHoursTurns
    .filter((turn) => clampInt(turn.day, 1, 30, null) === dayNumber)
    .map((turn) => ({
      id: turn.id,
      sessionId: turn.sessionId,
      requestId: turn.requestId,
      mode: turn.mode,
      signalId: turn.signalId,
      signalLabel: turn.signalLabel,
      questionText: turn.questionText,
      responseText: turn.responseText,
      responseDescription: turn.responseDescription,
      ...(turn.promptSnapshot ? { promptSnapshot: turn.promptSnapshot } : {}),
      ...(Array.isArray(turn.submissions) && turn.submissions.length ? { submissions: turn.submissions } : {}),
      ...(turn.revisedAt ? { revisedAt: turn.revisedAt } : {}),
      occurredAt: turn.occurredAt,
    }));
  const dayCommitments = commitments
    .filter((commitment) => clampInt(commitment.createdDay ?? commitment.day ?? commitment.cycle, 1, 30, null) === dayNumber)
    .map((commitment) => ({
      id: commitment.id,
      cycle: commitment.cycle,
      createdDay: commitment.createdDay,
      dueDay: commitment.dueDay,
      text: commitment.text,
      status: commitment.status,
      customer: commitment.customer,
      channel: commitment.channel,
      message: commitment.message,
      expectedEvidenceKind: commitment.expectedEvidenceKind,
      evidence: commitment.evidence || null,
      createdAt: commitment.createdAt,
    }));
  const recentSourceReads = sourceReads
    .slice(-12)
    .map((entry) => ({
      id: entry.id,
      sourceId: entry.sourceId,
      tool: entry.tool,
      path: entry.path,
      domain: entry.domain,
      summary: entry.summary,
      fingerprint: entry.fingerprint,
      readAt: entry.readAt,
    }));
  const summary = summarizeDayMemoryParts({
    day: dayNumber,
    curriculumAnswers: dayAnswers,
    officeHoursTurns: dayTurns,
    commitments: dayCommitments,
  });
  return normalizeDayMemory({
    schemaVersion: DAY_MEMORY_SCHEMA_VERSION,
    schema: DAY_MEMORY_SCHEMA,
    workspaceRoot: path.resolve(String(workspaceRoot || ".")),
    day: dayNumber,
    summary,
    details: {
      curriculumAnswers: dayAnswers,
      officeHoursTurns: dayTurns,
      commitments: dayCommitments,
      sourceReads: recentSourceReads,
      totalRecords: dayAnswers.length + dayTurns.length + dayCommitments.length + recentSourceReads.length,
    },
    updatedAt: now.toISOString(),
  }, { now });
}

function normalizeDayMemory(value = {}, { now = new Date() } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const day = clampInt(source.day, 1, 30, null);
  if (!day) return null;
  const details = source.details && typeof source.details === "object" && !Array.isArray(source.details)
    ? source.details
    : {};
  const curriculumAnswers = Array.isArray(details.curriculumAnswers) ? details.curriculumAnswers.map(redactSensitiveObject) : [];
  const officeHoursTurns = Array.isArray(details.officeHoursTurns) ? details.officeHoursTurns.map(redactSensitiveObject) : [];
  const commitments = Array.isArray(details.commitments) ? details.commitments.map(redactSensitiveObject) : [];
  const sourceReads = Array.isArray(details.sourceReads) ? details.sourceReads.map(redactSensitiveObject) : [];
  return {
    schemaVersion: DAY_MEMORY_SCHEMA_VERSION,
    schema: DAY_MEMORY_SCHEMA,
    workspaceRoot: cleanString(source.workspaceRoot ?? source.workspace_root, MAX_LONG_TEXT),
    day,
    summary: normalizeDayMemorySummary(source.summary, {
      day,
      curriculumAnswers,
      officeHoursTurns,
      commitments,
    }),
    details: {
      curriculumAnswers,
      officeHoursTurns,
      commitments,
      sourceReads,
      totalRecords: curriculumAnswers.length + officeHoursTurns.length + commitments.length + sourceReads.length,
    },
    updatedAt: normalizeIsoDate(source.updatedAt ?? source.updated_at, now),
  };
}

function summarizeDayMemoryParts({ day, curriculumAnswers = [], officeHoursTurns = [], commitments = [] } = {}) {
  const openCommitments = commitments.filter((commitment) =>
    !commitment?.evidence && ["open", "missed", "abandoned"].includes(commitment?.status || "open"),
  );
  const metCommitments = commitments.filter((commitment) => commitment?.evidence || commitment?.status === "met");
  const latestQuestion = cleanString(
    officeHoursTurns.at(-1)?.questionText
      || curriculumAnswers.at(-1)?.questionTitle
      || curriculumAnswers.at(-1)?.questionPrompt
      || "",
    180,
  );
  const latestAnswer = cleanString(
    officeHoursTurns.at(-1)?.responseText
      || curriculumAnswers.at(-1)?.answerTitle
      || curriculumAnswers.at(-1)?.freeformAnswer
      || curriculumAnswers.at(-1)?.answerDetail
      || "",
    220,
  );
  const latestCommitment = cleanString(openCommitments.at(-1)?.text || commitments.at(-1)?.text || "", 220);
  const text = [
    latestQuestion ? `Q ${latestQuestion}` : "",
    latestAnswer ? `A ${latestAnswer}` : "",
    latestCommitment ? `약속 ${latestCommitment}` : "",
  ].filter(Boolean).join(" · ") || "기록 없음";
  return {
    day: clampInt(day, 1, 30, null),
    text: cleanString(text, 500),
    latestQuestion,
    latestAnswer,
    latestCommitment,
    openCommitments: openCommitments.length,
    metCommitments: metCommitments.length,
    curriculumAnswerCount: curriculumAnswers.length,
    officeHoursTurnCount: officeHoursTurns.length,
  };
}

function normalizeDayMemorySummary(value = {}, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const derived = summarizeDayMemoryParts(fallback);
  return {
    day: clampInt(source.day, 1, 30, derived.day),
    text: cleanString(source.text, 500) || derived.text,
    latestQuestion: cleanString(source.latestQuestion ?? source.latest_question, 180) || derived.latestQuestion,
    latestAnswer: cleanString(source.latestAnswer ?? source.latest_answer, 220) || derived.latestAnswer,
    latestCommitment: cleanString(source.latestCommitment ?? source.latest_commitment, 220) || derived.latestCommitment,
    openCommitments: clampInt(source.openCommitments ?? source.open_commitments, 0, 100, derived.openCommitments),
    metCommitments: clampInt(source.metCommitments ?? source.met_commitments, 0, 100, derived.metCommitments),
    curriculumAnswerCount: clampInt(source.curriculumAnswerCount ?? source.curriculum_answer_count, 0, 100, derived.curriculumAnswerCount),
    officeHoursTurnCount: clampInt(source.officeHoursTurnCount ?? source.office_hours_turn_count, 0, 100, derived.officeHoursTurnCount),
  };
}

function buildDayRollup({
  targetDay = null,
  curriculumRecords = [],
  officeHoursTurns = [],
  commitments = [],
} = {}) {
  const maxDay = clampInt(targetDay, 1, 400, null)
    || Math.max(
      ...curriculumRecords.map((record) => clampInt(record.day, 1, 400, 0)),
      ...officeHoursTurns.map((turn) => clampInt(turn.day, 1, 400, 0)),
      ...commitments.map((commitment) => clampInt(commitment.createdDay ?? commitment.day ?? commitment.cycle, 1, 400, 0)),
      0,
    );
  if (!maxDay) return [];
  const output = [];
  const cappedMaxDay = Math.min(maxDay, 30);
  for (let day = 1; day <= cappedMaxDay; day += 1) {
    const dayAnswers = curriculumRecords.filter((record) => clampInt(record.day, 1, 400, null) === day);
    const dayTurns = officeHoursTurns.filter((turn) => clampInt(turn.day, 1, 400, null) === day);
    const dayCommitments = commitments.filter((commitment) =>
      clampInt(commitment.createdDay ?? commitment.day ?? commitment.cycle, 1, 400, null) === day,
    );
    if (!dayAnswers.length && !dayTurns.length && !dayCommitments.length) continue;
    const latestAnswer = dayAnswers[dayAnswers.length - 1] || null;
    const latestTurn = dayTurns[dayTurns.length - 1] || null;
    const openCommitments = dayCommitments.filter((commitment) =>
      !commitment?.evidence && ["open", "missed", "abandoned"].includes(commitment?.status || "open"),
    );
    const metCommitments = dayCommitments.filter((commitment) => commitment?.evidence || commitment?.status === "met");
    const topic = cleanString(
      latestTurn?.questionText
        || latestAnswer?.questionTitle
        || latestAnswer?.questionPrompt
        || latestAnswer?.dimension
        || "",
      120,
    );
    const answer = cleanString(
      latestTurn?.responseText
        || latestAnswer?.answerTitle
        || latestAnswer?.freeformAnswer
        || latestAnswer?.answerDetail
        || "",
      160,
    );
    const commitment = cleanString(openCommitments[openCommitments.length - 1]?.text || dayCommitments[dayCommitments.length - 1]?.text || "", 160);
    const summary = [
      topic ? `Q ${topic}` : "",
      answer ? `A ${answer}` : "",
      commitment ? `약속 ${commitment}` : "",
    ].filter(Boolean).join(" · ") || "기록 있음";
    output.push({
      day,
      summary: cleanString(summary, 360),
      curriculumAnswerCount: dayAnswers.length,
      officeHoursTurnCount: dayTurns.length,
      openCommitments: openCommitments.length,
      metCommitments: metCommitments.length,
      detailPath: `.agentic30/memory/days/day-${day}.json`,
    });
  }
  return output;
}

function normalizeDayRollupEntry(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const day = clampInt(source.day, 1, 30, null);
  if (!day) return null;
  return {
    day,
    summary: cleanString(source.summary, 500),
    curriculumAnswerCount: clampInt(source.curriculumAnswerCount ?? source.curriculum_answer_count, 0, 100, 0),
    officeHoursTurnCount: clampInt(source.officeHoursTurnCount ?? source.office_hours_turn_count, 0, 100, 0),
    openCommitments: clampInt(source.openCommitments ?? source.open_commitments, 0, 100, 0),
    metCommitments: clampInt(source.metCommitments ?? source.met_commitments, 0, 100, 0),
    detailPath: cleanString(source.detailPath ?? source.detail_path, 240) || `.agentic30/memory/days/day-${day}.json`,
  };
}

function normalizeDayRollupCumulative(value = {}, days = []) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const entries = Array.isArray(days) ? days : [];
  const derived = {
    dayCount: entries.length,
    openCommitments: entries.reduce((sum, day) => sum + clampInt(day.openCommitments, 0, 100, 0), 0),
    metCommitments: entries.reduce((sum, day) => sum + clampInt(day.metCommitments, 0, 100, 0), 0),
    curriculumAnswerCount: entries.reduce((sum, day) => sum + clampInt(day.curriculumAnswerCount, 0, 100, 0), 0),
    officeHoursTurnCount: entries.reduce((sum, day) => sum + clampInt(day.officeHoursTurnCount, 0, 100, 0), 0),
  };
  return {
    dayCount: clampInt(source.dayCount ?? source.day_count, 0, 30, derived.dayCount),
    openCommitments: clampInt(source.openCommitments ?? source.open_commitments, 0, 999, derived.openCommitments),
    metCommitments: clampInt(source.metCommitments ?? source.met_commitments, 0, 999, derived.metCommitments),
    curriculumAnswerCount: clampInt(source.curriculumAnswerCount ?? source.curriculum_answer_count, 0, 999, derived.curriculumAnswerCount),
    officeHoursTurnCount: clampInt(source.officeHoursTurnCount ?? source.office_hours_turn_count, 0, 999, derived.officeHoursTurnCount),
  };
}

function redactSensitiveObject(value) {
  if (Array.isArray(value)) return value.map(redactSensitiveObject);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    output[key] = redactSensitiveObject(item);
  }
  return output;
}

function assertWorkspace(workspaceRoot, operation) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error(`${operation}: workspaceRoot is required.`);
  }
}

function normalizeStringArray(value = [], maxItems = 20, maxLength = MAX_TEXT) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return values
    .map((item) => cleanString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeIsoDate(value, now = new Date()) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : now.toISOString();
}

function clampInt(value, min, max, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function cleanString(value = "", maxLength = MAX_TEXT) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function nullableCleanString(value = "", maxLength = MAX_TEXT) {
  const text = cleanString(value, maxLength);
  return text || null;
}

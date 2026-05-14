import fs from "node:fs/promises";
import { adaptCurriculumDay } from "./adaptive-curriculum.mjs";
import { detectRitualBoundary } from "./weekly-ritual.mjs";

export const BIP_COACH_SCHEMA_VERSION = 1;

export function makeDefaultBipCoachState(now = new Date()) {
  return {
    schemaVersion: BIP_COACH_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    sessionId: null,
    config: {
      provider: "codex",
      threadsHandle: "",
      sheetUrl: "",
      sheetId: "",
      sheetTabName: "",
      docUrl: "",
      docId: "",
      morningHour: 10,
      eveningHour: 21,
    },
    evidence: null,
    missionChoices: [],
    currentMission: null,
    streak: {
      current: 0,
      longest: 0,
      lastCompletedDate: null,
    },
    // Highest weekly_ritual day already surfaced to the user. Used by
    // `applyCurriculumDayUpdate` to ensure each ritual fires at most once
    // per workspace, even across multiple sessions opened on the same day.
    lastRitualDayObserved: 0,
    // Round 6 / CCG-Codex: pending ritual that has been persisted but not yet
    // acknowledged by a Mac client. Survives restarts so a broadcast that
    // failed (or arrived before any client connected) is replayed on next
    // boot. Cleared by `weekly_ritual_acknowledged` from the client.
    pendingRitualKey: null,
    pendingRitualDay: null,
    lastError: null,
  };
}

export async function loadBipCoachState(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return normalizeBipCoachState(JSON.parse(raw));
  } catch {
    return makeDefaultBipCoachState();
  }
}

export async function persistBipCoachState(filePath, state) {
  await fs.writeFile(filePath, JSON.stringify(normalizeBipCoachState(state), null, 2));
  await fs.chmod(filePath, 0o600).catch(() => {});
}

export function normalizeBipCoachState(payload = {}) {
  payload = objectOrEmpty(payload);
  const base = makeDefaultBipCoachState();
  const config = normalizeBipCoachConfig(payload.config ?? {});
  const evidence = normalizeBipCoachEvidence(payload.evidence);
  return {
    ...base,
    ...payload,
    schemaVersion: BIP_COACH_SCHEMA_VERSION,
    sessionId: payload.sessionId ? String(payload.sessionId).trim() : null,
    config,
    evidence,
    missionChoices: normalizeMissionChoices(payload.missionChoices, { keepIds: true }),
    currentMission: evidence ? (payload.currentMission ?? null) : null,
    streak: {
      ...base.streak,
      ...(payload.streak ?? {}),
    },
    lastRitualDayObserved:
      typeof payload.lastRitualDayObserved === "number"
      && Number.isFinite(payload.lastRitualDayObserved)
        ? payload.lastRitualDayObserved
        : 0,
    pendingRitualKey:
      typeof payload.pendingRitualKey === "string" && payload.pendingRitualKey.length > 0
        ? payload.pendingRitualKey
        : null,
    pendingRitualDay:
      typeof payload.pendingRitualDay === "number"
      && Number.isFinite(payload.pendingRitualDay)
        ? payload.pendingRitualDay
        : null,
    lastError: payload.lastError ?? null,
  };
}

// Pure transition. Folds a fresh curriculumDay into the bip-coach state,
// detecting any weekly-ritual boundary that just got crossed and updating
// `lastRitualDayObserved` BEFORE the caller emits the prompt — so two
// sessions racing through the same boundary will not both fire the ritual
// (Codex MEDIUM review).
//
// Round 6 / CCG-Codex addendum: a fresh ritual also lands in
// `pendingRitualKey`/`pendingRitualDay`. The caller persists state, broadcasts
// to clients, and only clears the pending fields after the client
// acknowledges. Boot replay reads the persisted pending fields to recover
// from crashes between persist and broadcast.
export function applyCurriculumDayUpdate(state, { curriculumDay } = {}) {
  const normalized = normalizeBipCoachState(state ?? {});
  const ritual = detectRitualBoundary({
    curriculumDay,
    lastRitualDayObserved: normalized.lastRitualDayObserved ?? 0,
  });
  if (!ritual) {
    return { ...normalized, pendingRitual: null };
  }
  return {
    ...normalized,
    lastRitualDayObserved: ritual.day,
    pendingRitualKey: ritual.ritualKey,
    pendingRitualDay: ritual.day,
    pendingRitual: ritual,
  };
}

// Clear the pending ritual after a client acknowledges. Pure.
export function acknowledgePendingRitual(state, { day } = {}) {
  const normalized = normalizeBipCoachState(state ?? {});
  if (typeof day === "number" && normalized.pendingRitualDay !== day) {
    // Acknowledging a different day than the one pending — leave pending
    // intact so a stale ack does not silently swallow a fresh ritual.
    return normalized;
  }
  return {
    ...normalized,
    pendingRitualKey: null,
    pendingRitualDay: null,
  };
}

function normalizeBipCoachEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") {
    return null;
  }
  if (evidence.fullRead === true) {
    return evidence;
  }
  const hasFullSheet = Array.isArray(evidence.allRows)
    && Number(evidence.sheetRowsRead ?? evidence.allRows.length) === evidence.allRows.length;
  const hasFullDoc = Object.prototype.hasOwnProperty.call(evidence, "docText");
  return hasFullSheet && hasFullDoc
    ? { ...evidence, fullRead: true }
    : null;
}

export function normalizeBipCoachConfig(config = {}) {
  config = objectOrEmpty(config);
  const sheetInfo = parseGoogleSheetUrl(config.sheetUrl || config.sheetId || "");
  const docInfo = parseGoogleDocUrl(config.docUrl || config.docId || "");
  const provider = config.provider === "claude" ? "claude" : "codex";
  return {
    provider,
    threadsHandle: cleanHandle(config.threadsHandle),
    sheetUrl: String(config.sheetUrl || "").trim(),
    sheetId: String(config.sheetId || sheetInfo.spreadsheetId || "").trim(),
    sheetTabName: String(config.sheetTabName || "").trim(),
    docUrl: String(config.docUrl || "").trim(),
    docId: String(config.docId || docInfo.documentId || "").trim(),
    morningHour: normalizeHour(config.morningHour, 10),
    eveningHour: normalizeHour(config.eveningHour, 21),
  };
}

export function mergeBipConfigIntoCoachState(state, bipConfig = {}) {
  bipConfig = objectOrEmpty(bipConfig);
  const externalDocs = bipConfig.externalDocs ?? {};
  const social = bipConfig.social ?? {};
  const firstSheet = firstValue(externalDocs.googleSheets);
  const firstDoc = firstValue(externalDocs.googleDocs);
  const current = normalizeBipCoachState(state);
  const config = normalizeBipCoachConfig({
    ...current.config,
    threadsHandle: current.config.threadsHandle || social.threads || "",
    sheetUrl: current.config.sheetUrl || firstSheet || "",
    docUrl: current.config.docUrl || firstDoc || "",
  });
  return normalizeBipCoachState({
    ...current,
    config,
  });
}

export function isBipCoachConfigured(state) {
  const config = normalizeBipCoachState(state).config;
  return Boolean(config.sheetId && config.docId);
}

export function formatBipCoachGwsError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();

  if (lower.includes("invalid_grant") || lower.includes("failed to get token") || lower.includes("authentication failed")) {
    return "Google 연결이 만료됐어요. 오늘 실행 카드에서 재인증하면 원래 작업을 이어서 실행합니다.";
  }

  if (lower.includes("`gws` cli not found") || lower.includes("gws cli not found")) {
    return "`gws` CLI를 찾지 못했어요. 오늘 실행 설정 카드에서 gws 확인/설치를 다시 시도하세요.";
  }

  if (
    lower.includes("access_denied")
    || lower.includes("developer hasn't given you access")
    || lower.includes("developer hasn’t given you access")
    || lower.includes("app is currently being tested")
  ) {
    return "Google OAuth 앱이 아직 테스트 모드라 이 계정이 차단됐어요. Google Cloud Console의 OAuth consent screen에서 이 Google 계정을 Test users에 추가한 뒤 다시 인증하세요.";
  }

  if (lower.includes("permission") || lower.includes("forbidden") || lower.includes("insufficient")) {
    return "Google Docs/Sheets 권한이 부족해요. 연결한 계정이 해당 Doc과 Sheet를 열 수 있는지 확인한 뒤 다시 시도하세요.";
  }

  return `Google Docs/Sheets 기록을 읽지 못했어요. ${message}`;
}

export function parseGoogleSheetUrl(value) {
  const input = String(value || "").trim();
  if (!input) {
    return { spreadsheetId: "", gid: "" };
  }
  const directMatch = input.match(/^[A-Za-z0-9_-]{20,}$/);
  if (directMatch) {
    return { spreadsheetId: input, gid: "" };
  }
  const idMatch = input.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  const gidMatch = input.match(/[?#&]gid=([0-9]+)/);
  return {
    spreadsheetId: idMatch?.[1] ?? "",
    gid: gidMatch?.[1] ?? "",
  };
}

export function parseGoogleDocUrl(value) {
  const input = String(value || "").trim();
  if (!input) {
    return { documentId: "" };
  }
  const directMatch = input.match(/^[A-Za-z0-9_-]{20,}$/);
  if (directMatch) {
    return { documentId: input };
  }
  const idMatch = input.match(/\/document\/d\/([A-Za-z0-9_-]+)/);
  return { documentId: idMatch?.[1] ?? "" };
}

export function pickSheetTab(metadata, preferredTitle = "") {
  const sheets = Array.isArray(metadata?.sheets) ? metadata.sheets : [];
  const titles = sheets
    .map((sheet) => sheet?.properties?.title)
    .filter((title) => typeof title === "string" && title.trim());
  if (!titles.length) {
    return preferredTitle || "Sheet1";
  }
  if (preferredTitle && titles.includes(preferredTitle)) {
    return preferredTitle;
  }
  const octoberTab = titles.find((title) => title === "@october.ai");
  return octoberTab || titles[0];
}

export function buildSheetRange(tabName) {
  const escaped = String(tabName || "Sheet1").replaceAll("'", "''");
  return `'${escaped}'!A:I`;
}

export function summarizeSheetValues(payload, { maxRecentRows = 7 } = {}) {
  const values = Array.isArray(payload?.values) ? payload.values : [];
  if (values.length < 2) {
    return {
      allRows: [],
      recentRows: [],
      summary: "Sheet에 기록된 최근 공개 기록 행이 아직 없습니다.",
    };
  }

  const headers = values[0].map((value) => String(value || "").trim());
  const rows = values
    .slice(1)
    .map((cells, index) => normalizeSheetRow(headers, cells, index + 2))
    .filter((row) => row.hasContent);
  const recentRows = rows.slice(-maxRecentRows);

  if (!rows.length) {
    return {
      allRows: [],
      recentRows: [],
      summary: "Sheet에 기록된 최근 공개 기록 행이 아직 없습니다.",
    };
  }

  const firstFollowers = rows.find((row) => row.followers)?.followers;
  const lastFollowers = [...rows].reverse().find((row) => row.followers)?.followers;
  const latest = rows[rows.length - 1];
  const insights = recentRows
    .map((row) => row.insights)
    .filter(Boolean)
    .slice(-3);
  const readableRows = rows.map(({ hasContent, ...row }) => row);

  return {
    allRows: readableRows,
    recentRows: readableRows.slice(-maxRecentRows),
    summary: [
      `전체 ${rows.length}개 공개 기록을 읽었습니다.`,
      recentRows.length ? `최근 ${recentRows.length}개 기록을 미션 후보에 우선 반영합니다.` : "",
      firstFollowers && lastFollowers ? `팔로어 변화: ${firstFollowers} -> ${lastFollowers}.` : "",
      latest?.date ? `마지막 기록일: ${latest.date}.` : "",
      insights.length ? `최근 배움: ${insights.join(" / ")}` : "",
    ].filter(Boolean).join(" "),
  };
}

export function extractGoogleDocPlainText(documentPayload, maxChars = Number.MAX_SAFE_INTEGER) {
  const chunks = [];
  collectGoogleDocText(documentPayload?.body?.content, chunks);
  if (Array.isArray(documentPayload?.tabs)) {
    for (const tab of documentPayload.tabs) {
      collectGoogleDocText(tab?.documentTab?.body?.content, chunks);
    }
  }
  const limit = Number.isFinite(maxChars) ? maxChars : Number.MAX_SAFE_INTEGER;
  return chunks.join("").replace(/\n{3,}/g, "\n\n").trim().slice(0, limit);
}

function collectGoogleDocText(content, chunks) {
  if (!Array.isArray(content)) {
    return;
  }

  for (const block of content) {
    const elements = block?.paragraph?.elements;
    if (Array.isArray(elements)) {
      for (const element of elements) {
        const text = element?.textRun?.content;
        if (typeof text === "string") {
          chunks.push(text);
        }
      }
    }

    const rows = block?.table?.tableRows;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const cells = row?.tableCells;
        if (!Array.isArray(cells)) continue;
        for (const cell of cells) {
          collectGoogleDocText(cell?.content, chunks);
        }
      }
    }

    collectGoogleDocText(block?.tableOfContents?.content, chunks);
  }
}

export function buildBipCoachMissionPrompt({
  state,
  compact = false,
  curriculumDay = null,
  today = todayKey(),
}) {
  const normalized = normalizeBipCoachState(state);
  const config = normalized.config;
  const adaptiveCurriculumDay = adaptCurriculumDay({ curriculumDay, state: normalized });
  const contextJson = JSON.stringify(
    {
      googleTools: {
        preferred: [
          "agentic30_sidecar.gws_sheets_read",
          "agentic30_sidecar.gws_docs_read",
        ],
        shellFallback: "gws CLI may be used only for read-only Sheets/Docs reads if MCP tools are unavailable.",
      },
      sheet: {
        spreadsheetId: config.sheetId,
        url: config.sheetUrl,
        preferredTab: config.sheetTabName || "@october.ai",
        fullRangeRule: "Read spreadsheet metadata first, choose the configured tab, @october.ai, or the first tab, then read '<tab>'!A:I.",
      },
      doc: {
        documentId: config.docId,
        url: config.docUrl,
        readRule: "Read the entire document payload before deciding the mission.",
      },
      threadsHandle: config.threadsHandle,
      streak: normalized.streak,
      currentMission: normalized.currentMission,
      curriculumDay: normalizeCurriculumDay(adaptiveCurriculumDay),
    },
    null,
    2,
  );

  return [
    "너는 Agentic30 Mac 앱의 Threads 전용 Build In Public 지속 코치다.",
    "대상 사용자는 앱/웹을 이미 만들었지만 첫 유저, 마케팅, 고객 피드백에서 막힌 기술친화 1인 빌더다.",
    "목표는 매일 완벽한 글이 아니라 7일 연속 Threads 게시와 Google Sheet/Docs 기록을 남기는 것이다.",
    "강하게 밀어붙이되 실패 조짐이 있으면 미션을 더 작게 줄여야 한다.",
    "",
    `오늘 날짜: ${today}`,
    `Threads: ${config.threadsHandle ? `@${config.threadsHandle}` : "미설정"}`,
    compact
      ? "오늘은 실패 방지 모드다. 15분 안에 끝나는 관찰글 중심으로 서로 다른 미션 후보 3개를 만든다."
      : "오늘은 오전 계획 모드다. 서로 다른 글쓰기 각도와 수행 난이도를 가진 미션 후보 3개를 만든다.",
    "",
    "필수 도구 사용 원칙:",
    "- 미션을 쓰기 전에 agentic30_sidecar.gws_sheets_read로 Google Sheet 메타데이터를 읽고, 선택한 탭의 '<tab>'!A:I 전체 범위를 다시 읽는다.",
    "- 미션을 쓰기 전에 agentic30_sidecar.gws_docs_read로 Google Doc 업무일지 전체 payload를 읽는다.",
    "- MCP 도구가 없을 때만 read-only gws CLI 명령으로 같은 내용을 직접 확인한다.",
    "- 업무일지 Doc과 SNS 기록 Sheet를 둘 다 전체 확인하기 전에는 미션 JSON을 작성하지 않는다.",
    "- A1:I40, 최근 N행, 마지막 행만 읽기, 앱이 넘겨준 과거 evidence만 사용하기는 금지다.",
    "- 최신 상태는 반드시 전체 Sheet 행의 마지막 비어 있지 않은 기록에서 판단한다.",
    "- 팔로워 수, 게시 횟수, 배움, 특이사항, 업무일지의 목표/막힘/반복 패턴을 글 각도에 반영한다.",
    "- Read Target JSON의 curriculumDay가 있으면 해당 Day의 title, tasks, output을 반드시 미션 수행 결과와 연결한다.",
    "- 3개 후보는 서로 달라야 한다. 예: 고객증거/제품진척/학습공개 중 하나씩 나누되, 오늘 커리큘럼과 공개 기록에 맞춰 조정한다.",
    "- 매일 미션에는 사용자가 의식적으로 훈련할 전략 질문 2개를 반드시 포함한다.",
    "- 첫 질문은 `/office-hours` 훈련이다. Demand reality, status quo, desperate specificity, narrowest wedge, observation, future-fit 중 오늘 기록에 가장 필요한 질문 하나를 골라 구체적으로 묻는다.",
    "- 둘째 질문은 `/plan-ceo-review` 훈련이다. 10-star product, premise challenge, scope expansion/reduction, narrowest useful version 중 오늘 계획을 더 날카롭게 만드는 질문 하나를 골라 구체적으로 묻는다.",
    "- 이 질문들은 전체 skill을 실행하라는 지시가 아니라 매일 5-10분짜리 사고 훈련이다. 미션 본문이나 eveningChecklist에 `/office-hours:`와 `/plan-ceo-review:` 라벨로 넣는다.",
    "- Sheet/Docs에는 절대 쓰지 않는다. 사용자가 수동으로 붙여넣을 수 있게 안내만 한다.",
    "- 도구 오류나 권한 문제로 전체 확인이 불가능하면 기록을 상상하지 말고, 사용자가 재인증/연결을 해야 한다는 미션만 반환한다.",
    "",
    "출력은 설명 없이 JSON 하나만 반환한다. Markdown 코드블록도 쓰지 않는다.",
    "스키마:",
    JSON.stringify({
      missions: [
        {
          title: "후보 1 제목",
          angle: "오늘 글의 관점 한 줄",
          mission: "구체적인 수행 지시. Threads URL과 Sheet 행 기록까지 포함.",
          drafts: ["Threads 초안 1", "Threads 초안 2", "Threads 초안 3"],
          eveningChecklist: ["Threads URL을 기록했다", "Sheet 오늘 행을 채웠다"],
          evidenceRefs: ["근거가 된 Sheet/Doc/커리큘럼 단서"],
        },
      ],
    }),
    "",
    "Read Target JSON:",
    contextJson,
  ].join("\n");
}

export function buildBipCoachMissionPromptFromEvidence({
  state,
  compact = false,
  curriculumDay = null,
  today = todayKey(),
  lane = "",
} = {}) {
  const normalized = normalizeBipCoachState(state);
  const config = normalized.config;
  const evidence = normalized.evidence || {};
  const laneInstruction = normalizeMissionLane(lane);
  const adaptiveCurriculumDay = adaptCurriculumDay({ curriculumDay, state: normalized });
  const contextJson = JSON.stringify(
    {
      sheet: {
        title: evidence.sheetTitle || "",
        tabName: evidence.sheetTabName || config.sheetTabName || "@october.ai",
        summary: evidence.summary || "",
        rowsRead: evidence.sheetRowsRead ?? (Array.isArray(evidence.allRows) ? evidence.allRows.length : 0),
        allRows: Array.isArray(evidence.allRows) ? evidence.allRows : [],
        recentRows: Array.isArray(evidence.recentRows) ? evidence.recentRows : [],
      },
      doc: {
        title: evidence.docTitle || "",
        text: evidence.docText || "",
      },
      threadsHandle: config.threadsHandle,
      streak: normalized.streak,
      currentMission: normalized.currentMission,
      curriculumDay: normalizeCurriculumDay(adaptiveCurriculumDay),
      lane: laneInstruction,
    },
    null,
    2,
  );

  return [
    "너는 Agentic30 Mac 앱의 Threads 전용 Build In Public 지속 코치다.",
    "sidecar가 이미 Google Sheet 전체 A:I 범위와 Google Doc 전체 payload를 읽어 아래 Evidence JSON에 넣었다.",
    "새 Google 도구를 호출하지 말고 Evidence JSON만 근거로 사용한다.",
    "대상 사용자는 앱/웹을 이미 만들었지만 첫 유저, 마케팅, 고객 피드백에서 막힌 기술친화 1인 빌더다.",
    "목표는 매일 완벽한 글이 아니라 7일 연속 Threads 게시와 Google Sheet/Docs 기록을 남기는 것이다.",
    "",
    `오늘 날짜: ${today}`,
    `Threads: ${config.threadsHandle ? `@${config.threadsHandle}` : "미설정"}`,
    compact
      ? "오늘은 실패 방지 모드다. 15분 안에 끝나는 관찰글 중심으로 미션을 만든다."
      : "오늘은 오전 계획 모드다. 글쓰기 각도와 수행 난이도가 분명한 미션을 만든다.",
    laneInstruction ? `이번 생성 lane: ${laneInstruction}` : "서로 다른 글쓰기 각도와 수행 난이도를 가진 미션 후보 3개를 만든다.",
    "",
    "필수 판단 원칙:",
    "- Evidence JSON의 sheet.allRows와 doc.text를 모두 근거로 삼는다.",
    "- 최신 상태는 Sheet 행의 마지막 비어 있지 않은 기록에서 판단한다.",
    "- 팔로워 수, 게시 횟수, 배움, 특이사항, 업무일지의 목표/막힘/반복 패턴을 글 각도에 반영한다.",
    "- Evidence JSON의 curriculumDay가 있으면 해당 Day의 title, tasks, output, personalization, evidenceNeeds, nextQuestions, layerChecks를 반드시 미션 수행 결과와 연결한다.",
    "- layerChecks는 Builder / Program / Agentic30 세 계층을 혼동하지 않기 위한 검문이다. 미션은 최소 한 계층의 증거를 명시적으로 남겨야 한다.",
    "- curriculumDay.personalization.evidenceGaps가 있으면 기능 추가보다 그 공백을 메우는 행동으로 미션을 진화시킨다.",
    "- curriculumDay.nextQuestions는 `/office-hours`와 `/plan-ceo-review` 훈련 질문이다. 후보 미션의 eveningChecklist에 같은 취지의 질문을 포함한다.",
    "- 매일 미션에는 사용자가 의식적으로 훈련할 전략 질문 2개를 반드시 포함한다.",
    "- 첫 질문은 `/office-hours` 훈련이다. Demand reality, status quo, desperate specificity, narrowest wedge, observation, future-fit 중 오늘 기록에 가장 필요한 질문 하나를 골라 구체적으로 묻는다.",
    "- 둘째 질문은 `/plan-ceo-review` 훈련이다. 10-star product, premise challenge, scope expansion/reduction, narrowest useful version 중 오늘 계획을 더 날카롭게 만드는 질문 하나를 골라 구체적으로 묻는다.",
    "- 이 질문들은 전체 skill을 실행하라는 지시가 아니라 매일 5-10분짜리 사고 훈련이다. 미션 본문이나 eveningChecklist에 `/office-hours:`와 `/plan-ceo-review:` 라벨로 넣는다.",
    "- Sheet/Docs에는 절대 쓰지 않는다. 사용자가 수동으로 붙여넣을 수 있게 안내만 한다.",
    "",
    "출력은 설명 없이 JSON 하나만 반환한다. Markdown 코드블록도 쓰지 않는다.",
    "스키마:",
    laneInstruction
      ? JSON.stringify({
          title: "후보 제목",
          angle: "오늘 글의 관점 한 줄",
          mission: "구체적인 수행 지시. Threads URL과 Sheet 행 기록까지 포함.",
          drafts: ["Threads 초안 1", "Threads 초안 2", "Threads 초안 3"],
          eveningChecklist: ["Threads URL을 기록했다", "Sheet 오늘 행을 채웠다"],
          evidenceRefs: ["근거가 된 Sheet/Doc/커리큘럼 단서"],
        })
      : JSON.stringify({
          missions: [
            {
              title: "후보 1 제목",
              angle: "오늘 글의 관점 한 줄",
              mission: "구체적인 수행 지시. Threads URL과 Sheet 행 기록까지 포함.",
              drafts: ["Threads 초안 1", "Threads 초안 2", "Threads 초안 3"],
              eveningChecklist: ["Threads URL을 기록했다", "Sheet 오늘 행을 채웠다"],
              evidenceRefs: ["근거가 된 Sheet/Doc/커리큘럼 단서"],
            },
          ],
        }),
    "",
    "Evidence JSON:",
    contextJson,
  ].join("\n");
}

function normalizeMissionLane(lane) {
  const key = String(lane || "").trim().toLowerCase();
  if (key === "customer_evidence") {
    return "고객증거: 실제 사용자/시장/반응/막힘 증거 하나를 Threads 글감으로 만든다.";
  }
  if (key === "product_progress") {
    return "제품진척: 오늘 커리큘럼 산출물과 구현 진척을 첫 유저 관점의 작은 공개글로 만든다.";
  }
  if (key === "learning_retro") {
    return "학습공개: 최근 기록에서 드러난 배움, 실패 조짐, 다음 실험을 솔직한 회고글로 만든다.";
  }
  return "";
}

export function parseMissionChoicesResponse(text, {
  provider = "codex",
  compact = false,
  today = todayKey(),
  now = new Date(),
  curriculumDay = null,
} = {}) {
  const parsed = parseFirstJsonValue(text);
  const rawChoices = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.missions)
      ? parsed.missions
      : parsed
        ? [parsed]
        : [];
  const choices = normalizeMissionChoices(rawChoices, {
    provider,
    compact,
    today,
    now,
    curriculumDay,
  });
  if (choices.length) {
    return padMissionChoices(choices, { provider, compact, today, now }).slice(0, 3);
  }
  return padMissionChoices([
    buildMission({
      title: compact ? "15분 관찰글 실행" : "오늘 실행",
      angle: "AI 응답을 구조화하지 못했습니다. 원문을 확인하고 가장 작은 실행으로 줄입니다.",
      mission: String(text || "").trim().slice(0, 2000),
      drafts: [],
      eveningChecklist: ["Threads URL을 기록했다", "Sheet 오늘 행을 채웠다"],
      evidenceRefs: [],
    }, { provider, compact, today, now, index: 0, curriculumDay }),
  ], { provider, compact, today, now, curriculumDay }).slice(0, 3);
}

export function buildFallbackBipMissionChoices({
  state,
  compact = false,
  curriculumDay = null,
  localEvidence = null,
  today = todayKey(),
  now = new Date(),
  provider = "local",
} = {}) {
  const normalized = normalizeBipCoachState(state);
  const evidence = normalized.evidence || {};
  const normalizedLocalEvidence = localEvidence && typeof localEvidence === "object" && !Array.isArray(localEvidence)
    ? localEvidence
    : null;
  const workspaceScan = normalizedLocalEvidence?.workspaceScan || {};
  const onboardingContext = normalizedLocalEvidence?.onboardingContext || {};
  const rows = Array.isArray(evidence.allRows) ? evidence.allRows.filter((row) => row?.hasContent !== false) : [];
  const recentRows = Array.isArray(evidence.recentRows) && evidence.recentRows.length
    ? evidence.recentRows
    : rows.slice(-7);
  const latest = [...recentRows].reverse().find((row) => row?.date || row?.posts?.length || row?.insights || row?.notes) || {};
  const previous = recentRows.length > 1 ? recentRows[recentRows.length - 2] : null;
  const localDocText = [
    workspaceScan.icp,
    workspaceScan.spec,
    workspaceScan.goal,
    workspaceScan.docs,
    workspaceScan.sheet,
  ].filter(Boolean).join(" ");
  const docText = String(evidence.docText || evidence.docExcerpt || localDocText || "").replace(/\s+/g, " ").trim();
  const curriculum = normalizeCurriculumDay(adaptCurriculumDay({ curriculumDay, state: normalized }));
  const dayLabel = curriculum.day ? `Day ${curriculum.day}` : "오늘 커리큘럼";
  const dayTitle = curriculum.title || "오늘 커리큘럼";
  const dayOutput = curriculum.output || "오늘 산출물";
  const primaryTask = Array.isArray(curriculum.tasks) && curriculum.tasks.length
    ? curriculum.tasks[0]
    : dayOutput;
  const adaptiveQuestionLines = Array.isArray(curriculum.nextQuestions) && curriculum.nextQuestions.length
    ? curriculum.nextQuestions
    : [
        `/office-hours: 이 미션이 실제 수요를 더 선명하게 보여주는 증거는 무엇인가?`,
        `/plan-ceo-review: 오늘 산출물의 narrowest useful version은 무엇인가?`,
      ];
  const evidenceGapLine = Array.isArray(curriculum.personalization?.evidenceGaps) && curriculum.personalization.evidenceGaps.length
    ? `현재 evidence gap: ${curriculum.personalization.evidenceGaps.join(", ")}`
    : "";
  const layerCheckLines = Array.isArray(curriculum.layerChecks) && curriculum.layerChecks.length
    ? curriculum.layerChecks.slice(0, 3)
    : [
        "Builder: 오늘 카드가 내 실제 행동을 바꿨나?",
        "Program: 이 실행이 반복 가능한 훈련 자산으로 남나?",
        "Product: 30일/100명/첫 매출 가설을 강화하나?",
      ];
  const hasGoogleProofSink = Boolean(
    normalized.config?.sheetUrl || normalized.config?.docUrl || evidence.source === "sidecar_gws",
  );
  const selectedRecordSources = Array.isArray(onboardingContext.isolation_levels)
    ? onboardingContext.isolation_levels
    : [];
  const localSourceLabel = selectedRecordSources.length
    ? selectedRecordSources.join(", ")
    : "프로젝트 폴더";
  const proofAction = hasGoogleProofSink
    ? "Threads에 쓰고 Sheet 오늘 행에 URL과 반응을 기록한다"
    : "프로젝트 폴더의 로컬 markdown 실행 로그에 한 줄로 남긴다";
  const proofTarget = hasGoogleProofSink
    ? null
    : "로컬 markdown 실행 로그에 오늘 증거, 확인 질문, 다음 24시간 실험을 남긴다.";
  const proofChecklist = hasGoogleProofSink
    ? ["Threads URL을 복사했다", "Sheet 오늘 행에 URL, 반응, 배운 점을 기록했다"]
    : ["로컬 실행 로그에 오늘 증거 한 줄을 남겼다", "다음 확인 질문을 프로젝트 문서에 적었다"];
  const proofRef = hasGoogleProofSink ? "공개 기록 Sheet 전체 기록" : `로컬 기록 소스: ${localSourceLabel}`;
  const latestInsight = latest.insights || latest.notes || docText.slice(0, 90) || "최근 로컬 기록에서 아직 선명한 배움이 부족합니다.";
  const followerLine = [previous?.followers, latest.followers].filter(Boolean).length === 2
    ? `팔로어 ${previous.followers} -> ${latest.followers}`
    : latest.followers
      ? `현재 팔로어 ${latest.followers}`
      : "팔로어 변화 미기록";
  const latestPost = Array.isArray(latest.posts) && latest.posts.length
    ? latest.posts[latest.posts.length - 1]
    : "최근 게시글 없음";
  const baseChecklist = [
    ...proofChecklist,
    ...adaptiveQuestionLines.slice(0, 2),
    ...layerCheckLines.slice(0, 3),
  ];
  const missions = [
    {
      title: compact ? "15분 고객증거 관찰글" : "고객증거를 한 줄로 공개하기",
      angle: `${dayLabel} ${dayTitle}를 실제 문제 증거와 연결한다.`,
      mission: `${primaryTask}를 하면서 발견한 실제 막힘이나 반복 문제 하나를 정리한다. ${evidenceGapLine ? `${evidenceGapLine}. ` : ""}${proofAction}.`,
      proofTarget,
      drafts: [
        `오늘 ${dayTitle}를 하면서 다시 확인한 문제: ${latestInsight} 그래서 오늘은 기능 설명보다 이 문제가 실제로 반복되는지 확인하려고 한다.`,
        `${followerLine}. 최근 기록을 보니 ${latestInsight} 오늘은 ${primaryTask}를 고객 문제 증거 하나로 좁혀 공개한다.`,
        `제품을 더 만들기 전에 확인할 것: 사람들이 정말 ${latestInsight} 상황에서 멈추는가. 오늘 ${dayOutput}은 이 질문을 검증하는 쪽으로 쓴다.`,
      ],
      eveningChecklist: baseChecklist,
      evidenceRefs: [
        latest.date ? `최신 Sheet 기록: ${latest.date}` : "최신 Sheet 기록",
        latestInsight,
        `${dayLabel}: ${dayTitle}`,
      ],
    },
    {
      title: compact ? "오늘 산출물 스냅샷" : "제품진척을 첫 유저 관점으로 공개하기",
      angle: `${dayOutput}을 기능 나열이 아니라 첫 사용자가 볼 변화로 설명한다.`,
      mission: `${dayTitle}의 산출물을 스크린샷 없이도 이해되는 한 문단으로 정리한다. “무엇이 가능해졌는지 / 아직 막힌 점 / 다음 확인” 3문장 구조로 쓰고 ${hasGoogleProofSink ? "Sheet에 URL을 남긴다" : "로컬 markdown 로그에 저장한다"}.`,
      proofTarget,
      drafts: [
        `오늘 만든 것: ${dayOutput}. 기능을 늘린 게 아니라, 첫 사용자가 ${primaryTask}를 더 빨리 끝낼 수 있는지 확인하려는 변화다.`,
        `${dayTitle} 진행 중. 오늘의 작은 진척은 ${dayOutput}이고, 아직 확인해야 할 점은 실제 사용자가 이 흐름을 헷갈리지 않는지다.`,
        `최근 게시 기준점은 “${latestPost}”. 오늘은 거기서 한 단계 더 가서 ${dayOutput}을 첫 유저 관점으로 설명해본다.`,
      ],
      eveningChecklist: baseChecklist,
      evidenceRefs: [
        `커리큘럼 산출물: ${dayOutput}`,
        latestPost,
        evidence.summary || proofRef,
      ],
    },
    {
      title: compact ? "배운 점 하나만 공개" : "학습 회고와 다음 실험 공개하기",
      angle: "반응을 해석하고 다음 실험을 작게 만든다.",
      mission: `최근 ${hasGoogleProofSink ? "Sheet/Doc" : "로컬 프로젝트"} 기록에서 배운 점 하나를 고르고, 그것이 오늘 ${dayTitle} 계획을 어떻게 바꾸는지 쓴다. 결론은 다음 24시간 안에 확인할 가장 작은 실험 하나로 끝낸다.`,
      proofTarget,
      drafts: [
        `최근 기록에서 배운 점: ${latestInsight} 오늘은 이걸 ${dayTitle}에 반영해서 ${primaryTask}만 확인한다.`,
        `반응이 크지 않을 때 내가 줄여야 할 것: 범위. 오늘 ${dayOutput}은 “더 만들기”보다 “더 작게 검증하기”로 진행한다.`,
        hasGoogleProofSink
          ? `오늘의 공개 회고: ${latestInsight} 그래서 다음 실험은 ${primaryTask}를 가장 작은 Threads 글 하나로 검증하는 것이다.`
          : `오늘의 로컬 회고: ${latestInsight} 그래서 다음 실험은 ${primaryTask}를 가장 작은 실행 로그 하나로 검증하는 것이다.`,
      ],
      eveningChecklist: baseChecklist,
      evidenceRefs: [
        latestInsight,
        docText ? `업무일지 단서: ${docText.slice(0, 120)}` : "업무일지 전체 payload 확인됨",
        `${dayLabel}: ${dayTitle}`,
      ],
    },
  ];

  return parseMissionChoicesResponse(JSON.stringify({ missions }), {
    provider,
    compact,
    today,
    now,
    curriculumDay,
  });
}

export function parseMissionResponse(text, {
  provider = "codex",
  compact = false,
  today = todayKey(),
  now = new Date(),
  curriculumDay = null,
} = {}) {
  return parseMissionChoicesResponse(text, { provider, compact, today, now, curriculumDay })[0];
}

export function completeBipCoachMission(state, {
  threadsUrl = "",
  sheetRowNote = "",
  completedAt = new Date(),
  today = todayKey(completedAt),
} = {}) {
  const normalized = normalizeBipCoachState(state);
  if (!normalized.currentMission) {
    throw new Error("No BIP mission is active.");
  }
  const mission = {
    ...normalized.currentMission,
    status: "completed",
    threadsUrl: String(threadsUrl || "").trim(),
    sheetRowNote: String(sheetRowNote || "").trim(),
    completedAt: completedAt.toISOString(),
  };
  const previousDate = normalized.streak?.lastCompletedDate;
  const continued = previousDate && daysBetween(previousDate, today) === 1;
  const sameDay = previousDate === today;
  const current = sameDay
    ? normalized.streak.current
    : continued
      ? normalized.streak.current + 1
      : 1;
  return normalizeBipCoachState({
    ...normalized,
    updatedAt: completedAt.toISOString(),
    currentMission: mission,
    streak: {
      current,
      longest: Math.max(current, normalized.streak.longest || 0),
      lastCompletedDate: today,
    },
    lastError: null,
  });
}

export function todayKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function normalizeSheetRow(headers, cells, rowNumber) {
  const read = (...names) => {
    for (const name of names) {
      const index = headers.indexOf(name);
      if (index >= 0) {
        return String(cells[index] ?? "").trim();
      }
    }
    return "";
  };
  const posts = [
    read("게시물"),
    read("게시물 1"),
    read("게시물 2"),
    read("게시물 3"),
  ].filter(Boolean);
  const row = {
    rowNumber,
    date: read("날짜"),
    followers: read("팔로어"),
    posts,
    notes: read("특이사항"),
    insights: read("인사이트와 배움"),
    writingTime: read("글 쓰는데 소요된 시간"),
  };
  return {
    ...row,
    hasContent: Boolean(
      row.date || row.followers || row.posts.length || row.notes || row.insights || row.writingTime,
    ),
  };
}

function parseFirstJsonValue(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const unfenced = fenceMatch?.[1]?.trim() ?? raw;
  const objectStart = unfenced.indexOf("{");
  const arrayStart = unfenced.indexOf("[");
  const startsWithArray = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart);
  const candidate = startsWithArray
    ? unfenced.slice(arrayStart, unfenced.lastIndexOf("[") === arrayStart ? unfenced.lastIndexOf("]") + 1 : unfenced.lastIndexOf("]") + 1)
    : unfenced.slice(objectStart, unfenced.lastIndexOf("}") + 1);
  if (!candidate || (!candidate.startsWith("{") && !candidate.startsWith("["))) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function normalizeMissionChoices(value, {
  provider = "codex",
  compact = false,
  today = todayKey(),
  now = new Date(),
  keepIds = false,
  curriculumDay = null,
} = {}) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((mission, index) => buildMission(mission, { provider, compact, today, now, index, keepIds, curriculumDay }))
    .filter((mission) => mission.title || mission.mission);
}

function buildMission(mission = {}, {
  provider = "codex",
  compact = false,
  today = todayKey(),
  now = new Date(),
  index = 0,
  keepIds = false,
  curriculumDay = null,
} = {}) {
  mission = objectOrEmpty(mission);
  const id = keepIds && mission.id
    ? String(mission.id)
    : `${today}-${now.getTime()}-${index + 1}`;
  return {
    id,
    date: stringOrDefault(mission.date, today),
    provider: mission.provider === "claude" ? "claude" : provider,
    status: stringOrDefault(mission.status, "drafted"),
    compact: typeof mission.compact === "boolean" ? mission.compact : Boolean(compact),
    title: stringOrDefault(mission.title, compact ? `15분 관찰글 실행 ${index + 1}` : `오늘 실행 ${index + 1}`),
    angle: stringOrDefault(mission.angle, ""),
    mission: stringOrDefault(mission.mission, ""),
    proofTarget: stringOrDefault(mission.proofTarget, buildDefaultProofTarget(mission, compact)),
    curriculumDay: normalizeCurriculumDay(mission.curriculumDay ?? curriculumDay),
    drafts: normalizeStringArray(mission.drafts).slice(0, 3),
    eveningChecklist: normalizeStringArray(mission.eveningChecklist),
    evidenceRefs: normalizeStringArray(mission.evidenceRefs),
    generatedAt: stringOrDefault(mission.generatedAt, now.toISOString()),
    completedAt: mission.completedAt ?? null,
    completedQuestionCount: normalizePositiveInteger(
      mission.completedQuestionCount ?? mission.completed_question_count ?? mission.questionCount ?? mission.question_count,
    ),
    threadsUrl: stringOrDefault(mission.threadsUrl, ""),
    sheetRowNote: stringOrDefault(mission.sheetRowNote, ""),
  };
}

function buildDefaultProofTarget(mission = {}, compact = false) {
  const title = stringOrDefault(mission.title, compact ? "15분 공개 실행" : "오늘 공개 실행");
  return `${title}을 Threads에 올리고, Sheet 오늘 행에 URL과 확인할 반응 1개를 기록한다.`;
}

function padMissionChoices(choices, {
  provider = "codex",
  compact = false,
  today = todayKey(),
  now = new Date(),
} = {}) {
  const next = [...choices];
  const templates = [
    {
      title: compact ? "15분 고객 관찰글" : "고객 증거 공개 실행",
      angle: "오늘 기록에서 가장 구체적인 고객 문제 하나를 공개한다",
      mission: "공개 기록과 오늘 커리큘럼에서 고객/문제 증거 하나를 골라 Threads에 짧게 쓰고, URL과 반응을 Sheet에 남긴다.",
    },
    {
      title: compact ? "15분 제품 진행글" : "제품 진행 공개 실행",
      angle: "오늘 만든 산출물을 다음 사용자 행동과 연결한다",
      mission: "사이드바 Day 산출물과 연결되는 제품 진행 하나를 골라 현재 상태, 막힌 점, 다음 확인 질문을 Threads에 올린다.",
    },
    {
      title: compact ? "15분 학습 회고글" : "학습 공개 실행",
      angle: "최근 공개 기록에서 배운 점 하나를 다음 실험으로 바꾼다",
      mission: "최근 Sheet/Doc 기록에서 반복되는 배움 하나를 골라 무엇을 바꿀지 공개하고, 오늘 완료 기준을 Sheet에 기록한다.",
    },
  ];
  for (const template of templates.slice(next.length)) {
    if (next.length >= 3) break;
    next.push(buildMission({
      ...template,
      drafts: [],
      eveningChecklist: ["Threads URL을 기록했다", "Sheet 오늘 행을 채웠다"],
      evidenceRefs: ["공개 기록과 오늘 커리큘럼을 함께 반영하도록 보정된 후보"],
    }, {
      provider,
      compact,
      today,
      now,
      index: next.length,
    }));
  }
  return next;
}

function normalizeCurriculumDay(value) {
  const day = objectOrEmpty(value);
  if (!Object.keys(day).length) {
    return null;
  }
  return {
    day: Number.isFinite(Number(day.day)) ? Number(day.day) : null,
    phase: stringOrDefault(day.phase, ""),
    phaseTitle: stringOrDefault(day.phaseTitle, ""),
    title: stringOrDefault(day.title, ""),
    shortTitle: stringOrDefault(day.shortTitle, ""),
    summary: stringOrDefault(day.summary, ""),
    tasks: normalizeStringArray(day.tasks),
    output: stringOrDefault(day.output, ""),
    valueContract: objectOrEmpty(day.valueContract),
    personalization: objectOrEmpty(day.personalization),
    evidenceNeeds: normalizeStringArray(day.evidenceNeeds),
    nextQuestions: normalizeStringArray(day.nextQuestions),
    layerFocus: normalizeStringArray(day.layerFocus),
    layerChecks: normalizeStringArray(day.layerChecks),
    evolutionRule: stringOrDefault(day.evolutionRule, ""),
    stopOrPivotCheck: stringOrDefault(day.stopOrPivotCheck, ""),
    staticDay: objectOrEmpty(day.staticDay),
  };
}

function normalizeHour(value, fallback) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0 && number <= 23) {
    return number;
  }
  return fallback;
}

function cleanHandle(value) {
  return String(value || "").trim().replace(/^@+/, "");
}

function firstValue(value) {
  if (Array.isArray(value)) {
    return String(value.find(Boolean) || "").trim();
  }
  return String(value || "").split(",").map((item) => item.trim()).find(Boolean) || "";
}

function objectOrEmpty(value) {
  return value && typeof value === "object" ? value : {};
}

function stringOrDefault(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizePositiveInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function daysBetween(previousDate, nextDate) {
  const previous = Date.parse(`${previousDate}T00:00:00Z`);
  const next = Date.parse(`${nextDate}T00:00:00Z`);
  if (!Number.isFinite(previous) || !Number.isFinite(next)) {
    return Number.NaN;
  }
  return Math.round((next - previous) / 86_400_000);
}

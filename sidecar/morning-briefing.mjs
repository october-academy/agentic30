import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson } from "./atomic-store.mjs";
import { normalizeMorningBriefingDrilldowns } from "./morning-briefing-drilldown.mjs";

export const MORNING_BRIEFING_SCHEMA_VERSION = 1;
export const MORNING_BRIEFING_FILE = "morning-briefing.json";
export const MORNING_BRIEFING_HISTORY_LIMIT = 14;
export const MORNING_BRIEFING_TOTAL_DAYS = 30;

const CARD_ORDER = Object.freeze(["cloudflare", "github", "posthog"]);

export const MORNING_BRIEFING_ANOMALY_OPTION_SETS = Object.freeze({
  metric_drop: [
    {
      id: "real_churn",
      title: "실제 이탈이다",
      detail: "신호 하락이 실제 사용자 행동 변화로 보입니다. 오늘 바로 사용자에게 물어봅니다.",
      tail: "메시지 + 실험",
    },
    {
      id: "tracking_gap",
      title: "추적 누락이다",
      detail: "이벤트가 일부 안 잡혔을 수 있습니다. 계측부터 손봅니다.",
      tail: "계측 우선",
    },
    {
      id: "small_sample",
      title: "표본이 너무 작다",
      detail: "표본이 작아 한두 명 변화가 크게 보입니다. 며칠 더 모은 뒤 판단합니다.",
      tail: "판단 보류",
    },
    {
      id: "custom",
      title: "다르게 본다",
      detail: "위 셋이 아니면 직접 라벨을 남깁니다. 오늘 브리핑 근거에 기록됩니다.",
      tail: "직접 입력",
    },
  ],
  build_without_evidence: [
    {
      id: "ship_to_user",
      title: "사람에게 보여줄 차례다",
      detail: "코드 신호만 쌓였습니다. 오늘은 만든 것을 실제 사람 1명에게 보여줍니다.",
      tail: "메시지 우선",
    },
    {
      id: "instrument_first",
      title: "계측이 먼저다",
      detail: "고객 행동을 잡을 이벤트 자체가 없을 수 있습니다. 계측부터 깝니다.",
      tail: "계측 우선",
    },
    {
      id: "intentional_build",
      title: "의도된 빌드 구간이다",
      detail: "지금은 의도적으로 빌드에 집중하는 구간입니다. 내일 다시 확인합니다.",
      tail: "판단 보류",
    },
    {
      id: "custom",
      title: "다르게 본다",
      detail: "위 셋이 아니면 직접 라벨을 남깁니다. 오늘 브리핑 근거에 기록됩니다.",
      tail: "직접 입력",
    },
  ],
});

function cleanString(value, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanMultiline(value, max = 1200) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIso(value) {
  const ts = Date.parse(String(value ?? ""));
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

function nowIso(now) {
  if (now instanceof Date) return now.toISOString();
  const ts = Number(now);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString();
}

function localDateKey(iso) {
  return String(iso || "").slice(0, 10);
}

function timeLabel(iso) {
  const ts = Date.parse(String(iso || ""));
  if (!Number.isFinite(ts)) return "";
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function sourceById(sources = []) {
  return new Map((Array.isArray(sources) ? sources : []).map((source) => [source?.id, source]));
}

// ── Metric extraction ────────────────────────────────────────────────────────
// Each digest source exposes raw counts; the briefing cards need one headline
// metric per card plus the raw counts as detail rows. github merges git + gh_cli
// (commits as the headline, PRs/releases as rows) so the card grid matches the
// three-sources design while the sync pills keep the four real connections.

function pickCount(counts = {}, keys = []) {
  for (const key of keys) {
    const value = finiteNumber(counts?.[key]);
    if (value !== null) return value;
  }
  return null;
}

export function extractMorningBriefingMetrics({ sources = [] } = {}) {
  const byId = sourceById(sources);
  const git = byId.get("git");
  const gh = byId.get("gh_cli");
  const posthog = byId.get("posthog");
  const cloudflare = byId.get("cloudflare");
  const metrics = {};
  if (cloudflare?.state === "ready") {
    metrics.cloudflare = pickCount(cloudflare.counts, ["visits", "uniqueVisitors", "visitors", "requests", "pageviews", "pageViews"]) ?? 0;
  }
  if (git?.state === "ready" || gh?.state === "ready") {
    metrics.github = pickCount(git?.counts, ["commits"]) ?? pickCount(gh?.counts, ["prs"]) ?? 0;
  }
  if (posthog?.state === "ready") {
    metrics.posthog = pickCount(posthog.counts, ["activeUsers", "events", "conversions"]) ?? 0;
  }
  return metrics;
}

function deltaFor(current, previous) {
  const cur = finiteNumber(current);
  const prev = finiteNumber(previous);
  if (cur === null || prev === null) return null;
  const diff = cur - prev;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const pct = prev > 0 ? Math.round((diff / prev) * 100) : null;
  const label = direction === "flat"
    ? "변화 없음"
    : pct !== null && Math.abs(pct) <= 999
      ? `${direction === "up" ? "▲" : "▼"} ${Math.abs(pct)}%`
      : `${direction === "up" ? "▲" : "▼"} ${Math.abs(diff)}`;
  return { direction, diff, pct, label, previous: prev };
}

function countRows(counts = {}, defs = []) {
  return defs
    .map(([key, label, format]) => {
      const value = finiteNumber(counts?.[key]);
      if (value === null) return null;
      return { k: label, v: format ? format(value) : String(value) };
    })
    .filter(Boolean);
}

function sparkFrom(history = [], cardId = "", current = null) {
  const values = history
    .map((entry) => finiteNumber(entry?.metrics?.[cardId]))
    .filter((value) => value !== null);
  if (finiteNumber(current) !== null) values.push(Number(current));
  return values.slice(-8);
}

// ── Cards ────────────────────────────────────────────────────────────────────

export function buildMorningBriefingCards({ digest = {}, previousMetrics = {}, history = [] } = {}) {
  const byId = sourceById(digest.sources || []);
  const metrics = extractMorningBriefingMetrics({ sources: digest.sources || [] });
  const cards = [];

  const cloudflare = byId.get("cloudflare");
  cards.push(buildCard({
    id: "cloudflare",
    label: "Cloudflare",
    subtitle: "트래픽 · 방문 추이",
    state: cloudflare?.state || "missing",
    metricValue: metrics.cloudflare ?? null,
    metricUnit: "순 방문",
    source: cloudflare,
    previousMetrics,
    history,
    rows: countRows(cloudflare?.counts, [
      ["pageviews", "페이지뷰"],
      ["pageViews", "페이지뷰"],
      ["requests", "요청"],
      ["conversions", "방문 → 가입"],
    ]).slice(0, 2),
  }));

  const git = byId.get("git");
  const gh = byId.get("gh_cli");
  const githubReady = git?.state === "ready" || gh?.state === "ready";
  cards.push(buildCard({
    id: "github",
    label: "GitHub",
    subtitle: "커밋 · PR · 배포",
    state: githubReady ? "ready" : (git?.state || gh?.state || "missing"),
    metricValue: metrics.github ?? null,
    metricUnit: "커밋",
    source: githubReady
      ? {
          ...((git?.state === "ready" ? git : gh) || {}),
          highlights: [...(git?.highlights || []), ...(gh?.highlights || [])],
          summary: [git?.summary, gh?.summary].filter(Boolean).join(" / "),
        }
      : git || gh,
    previousMetrics,
    history,
    rows: [
      ...countRows(gh?.counts, [
        ["prs", "PR 업데이트"],
        ["mergedPrs", "PR 머지"],
        ["releases", "릴리즈"],
      ]),
      ...countRows(git?.counts, [
        ["additions", "추가 라인", (value) => `+${value}`],
        ["uncommittedChanges", "미커밋 변경"],
      ]),
    ].slice(0, 2),
  }));

  const posthog = byId.get("posthog");
  cards.push(buildCard({
    id: "posthog",
    label: "PostHog",
    subtitle: "활성 사용자 · 이벤트",
    state: posthog?.state || "missing",
    metricValue: metrics.posthog ?? null,
    metricUnit: "활성 사용자",
    source: posthog,
    previousMetrics,
    history,
    rows: countRows(posthog?.counts, [
      ["events", "이벤트"],
      ["conversions", "전환"],
    ]).slice(0, 2),
  }));

  return cards.sort((a, b) => CARD_ORDER.indexOf(a.id) - CARD_ORDER.indexOf(b.id));
}

function buildCard({
  id,
  label,
  subtitle,
  state,
  metricValue,
  metricUnit,
  source,
  previousMetrics,
  history,
  rows = [],
}) {
  const ready = state === "ready";
  const delta = ready ? deltaFor(metricValue, previousMetrics?.[id]) : null;
  const note = cleanString(
    ready
      ? (source?.evidenceGaps?.[0] || source?.goalSignals?.[0] || source?.highlights?.[0] || "")
      : (source?.detail || "연결되지 않음"),
    120,
  );
  return {
    id,
    label,
    subtitle,
    state: ready ? "ready" : (state || "missing"),
    metric: {
      value: ready ? finiteNumber(metricValue) ?? 0 : null,
      unit: metricUnit,
      deltaLabel: delta?.label || null,
      direction: delta?.direction || null,
      versusLabel: delta ? `어제 ${delta.previous}` : null,
    },
    rows: rows.map((row) => ({ k: cleanString(row.k, 40), v: cleanString(row.v, 80) })),
    spark: ready ? sparkFrom(history, id, metricValue) : [],
    note,
    noteTone: ready && (source?.evidenceGaps?.length || delta?.direction === "down") ? "warn" : "info",
    highlights: (source?.highlights || []).slice(0, 4),
  };
}

// ── Summary ──────────────────────────────────────────────────────────────────

export function buildMorningBriefingSummary({ digest = {}, cards = [], window = {} } = {}) {
  const readyCards = cards.filter((card) => card.state === "ready");
  const downCard = readyCards.find((card) => card.metric?.direction === "down");
  const upCard = readyCards.find((card) => card.metric?.direction === "up");
  const parts = [];
  // Exact substrings of the final statement, so the screen can render the
  // briefing.html mark (rose) / em (accent) inline highlights.
  const marks = [];
  const emphases = [];
  if (downCard) {
    const phrase = `${downCard.label} ${downCard.metric.unit} ${downCard.metric.deltaLabel} 하락`;
    parts.push(`밤사이 가장 큰 변화는 ${phrase}이에요.`);
    marks.push(phrase);
    if (upCard) {
      const upPhrase = `${upCard.label} ${upCard.metric.unit}은 ${upCard.metric.deltaLabel}`;
      parts.push(`${upPhrase} 늘었어요.`);
      emphases.push(upPhrase);
    }
  } else if (upCard) {
    const phrase = `${upCard.label} ${upCard.metric.unit} ${upCard.metric.deltaLabel} 증가`;
    parts.push(`밤사이 가장 큰 변화는 ${phrase}예요.`);
    emphases.push(phrase);
  }
  const overnight = (digest.briefing?.overnightChanges || []).slice(0, 2);
  parts.push(...overnight);
  if (!parts.length) parts.push("밤사이 연결된 소스에서 큰 변화는 없었어요.");
  const statement = parts.join(" ").slice(0, 600);
  const crits = readyCards
    .filter((card) => card.metric?.deltaLabel)
    .map((card) => ({
      source: card.label,
      label: card.metric.unit,
      value: card.metric.deltaLabel,
      direction: card.metric.direction || "flat",
    }));
  return {
    title: "overnight digest",
    windowLabel: cleanString(window.label || "", 120),
    statement,
    statementMarks: marks.filter((phrase) => statement.includes(phrase)),
    statementEmphases: emphases.filter((phrase) => statement.includes(phrase)),
    crits,
  };
}

// ── Timeline ─────────────────────────────────────────────────────────────────

export function buildMorningBriefingTimeline({ digest = {} } = {}) {
  const events = [];
  for (const source of digest.sources || []) {
    const cardId = source.id === "git" || source.id === "gh_cli" ? "github" : source.id;
    for (const event of source.events || []) {
      const at = toIso(event?.at);
      const text = cleanString(event?.text, 200);
      if (!at || !text) continue;
      events.push({ at, timeLabel: timeLabel(at), source: cardId, text });
    }
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (events.length) return events.slice(-10);
  // No timestamped events: fall back to highlight lines so the timeline section
  // still tells the overnight story instead of rendering empty.
  return (digest.briefing?.overnightChanges || []).slice(0, 4).map((text) => ({
    at: null,
    timeLabel: "밤사이",
    source: "digest",
    text: cleanString(text, 200),
  }));
}

// ── Anomaly ──────────────────────────────────────────────────────────────────

export function detectMorningBriefingAnomaly({ digest = {}, cards = [] } = {}) {
  const dropCard = cards.find(
    (card) =>
      card.state === "ready"
      && card.metric?.direction === "down"
      && cardDropIsSignificant(card),
  );
  if (dropCard) {
    return {
      id: `metric_drop_${dropCard.id}`,
      kind: "metric_drop",
      title: `${dropCard.label} 신호 하락`,
      question: `${dropCard.label} ${dropCard.metric.unit}이(가) ${dropCard.metric.versusLabel || "어제"} → ${dropCard.metric.value}로 떨어졌어요. 한 가지로 라벨링하면 오늘 액션이 달라져요.`,
      evidence: `근거: ${dropCard.label} ${dropCard.metric.unit} ${dropCard.metric.deltaLabel || ""}`.trim(),
      options: MORNING_BRIEFING_ANOMALY_OPTION_SETS.metric_drop,
      label: null,
      labeledAt: null,
    };
  }
  if (digest.buildWithoutCustomerEvidence) {
    return {
      id: "build_without_evidence",
      kind: "build_without_evidence",
      title: "코드 신호만 있고 고객 증거가 없어요",
      question: "밤사이 신호가 코드 변경 중심이에요. 고객 행동 증거가 없는 상태를 어떻게 볼까요?",
      evidence: cleanString(digest.briefing?.biggestEvidenceGap?.[0] || "근거: git 커밋은 있지만 PostHog 고객 행동 신호가 0입니다.", 200),
      options: MORNING_BRIEFING_ANOMALY_OPTION_SETS.build_without_evidence,
      label: null,
      labeledAt: null,
    };
  }
  return null;
}

function cardDropIsSignificant(card) {
  const label = String(card.metric?.deltaLabel || "");
  const match = label.match(/▼\s*(\d+)/);
  if (!match) return false;
  return Number(match[1]) >= 25;
}

// ── Action drafts ────────────────────────────────────────────────────────────

export function buildMorningBriefingActions({ digest = {}, anomaly = null } = {}) {
  const gap = cleanString(digest.briefing?.biggestEvidenceGap?.[0] || "", 200);
  const signal = cleanString(digest.briefing?.goalHelpfulSignals?.[0] || "", 200);
  const anomalyTitle = anomaly ? cleanString(anomaly.title, 80) : "";

  const messageBody = [
    "안녕하세요 {이름}님, Agentic30 만들고 있는 zettalyst예요.",
    "",
    anomaly
      ? `어제 ${anomalyTitle} 신호가 보여서요. 실제로 쓰시면서 막히거나 그만두게 된 지점이 있었는지 궁금해요.`
      : "어제 써 보신 흐름에서 막히거나 그냥 안 쓰게 된 지점이 있었는지 궁금해요.",
    "",
    "— 고치려는 게 아니라, 왜 그랬는지가 궁금해서요.",
  ].join("\n");

  const experimentBody = [
    "# 실험: evidence-gap-probe",
    `가설   ${gap || "가장 큰 증거 공백을 좁히면 다음 행동이 명확해진다"}`,
    "대상   최근 활성 사용자 · 신규 가입자",
    "측정   고객 행동 증거 1건 (주) · 응답률 (보조)",
    "기간   3일 또는 응답 n≥3 중 늦은 쪽",
  ].join("\n");

  const taskItems = [
    anomaly
      ? { title: `${anomalyTitle} 라벨 확정 후 첫 액션 실행`, tag: "신뢰도" }
      : { title: "가장 큰 증거 공백 1개 좁히기", tag: "검증" },
    { title: signal ? `신호 후속: ${signal}` : "연결된 소스 신호 후속 확인", tag: "관측" },
    { title: gap ? `증거 공백 메우기: ${gap}` : "고객 행동 증거 1건 확보", tag: "검증" },
  ];

  return [
    {
      id: "message",
      kind: "message",
      badge: "메시지",
      title: anomaly ? `${anomalyTitle} 관련 사용자에게 보낼 DM` : "어제 사용자에게 보낼 확인 DM",
      subtitle: "Mom Test 톤 · 답을 유도하지 않는 질문",
      body: cleanMultiline(messageBody),
      why: "이탈/정체 원인은 1:1로 물어보면 가장 빨리 잡혀요.",
      copyText: cleanMultiline(messageBody),
      applyLabel: "큐에 추가",
      tasks: [],
    },
    {
      id: "experiment",
      kind: "experiment",
      badge: "실험",
      title: "증거 공백을 좁히는 실험",
      subtitle: "가설 · 측정지표 초안",
      body: cleanMultiline(experimentBody),
      why: "공백이 한 곳에 몰려 있으면, 그 지점을 검증하는 게 가장 깨끗해요.",
      copyText: cleanMultiline(experimentBody),
      applyLabel: "실험 생성",
      tasks: [],
    },
    {
      id: "task",
      kind: "task",
      badge: "태스크",
      title: "오늘 빌드에 추가할 태스크",
      subtitle: "증거 신뢰도부터 확보",
      body: "",
      why: "추적이 못 믿을 상태면 실험 결과도 못 믿어요.",
      copyText: taskItems.map((item) => item.title).join(" / "),
      applyLabel: "오늘 태스크에 추가",
      tasks: taskItems.map((item) => ({ title: cleanString(item.title, 120), tag: cleanString(item.tag, 20) })),
    },
  ];
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export function buildMorningBriefing({
  digest = {},
  day = null,
  previous = null,
  history = [],
  now = new Date(),
  phase = "",
  drilldowns = null,
} = {}) {
  const generatedAt = nowIso(now);
  const window = digest.window || {};
  const previousMetrics = previous?.metrics
    || history[history.length - 1]?.metrics
    || {};
  const priorHistory = history.filter((entry) => entry?.date !== localDateKey(generatedAt));
  const cards = buildMorningBriefingCards({ digest, previousMetrics, history: priorHistory });
  const anomaly = detectMorningBriefingAnomaly({ digest, cards });
  const normalizedDay = finiteNumber(day);
  const readyCount = cards.filter((card) => card.state === "ready").length;
  return {
    schemaVersion: MORNING_BRIEFING_SCHEMA_VERSION,
    generatedAt,
    day: normalizedDay,
    totalDays: MORNING_BRIEFING_TOTAL_DAYS,
    phase: cleanString(phase, 30),
    window: {
      startIso: window.startIso || null,
      untilIso: window.untilIso || null,
      label: cleanString(window.label || "", 120),
    },
    summary: buildMorningBriefingSummary({ digest, cards, window }),
    cards,
    timeline: buildMorningBriefingTimeline({ digest }),
    anomaly,
    actions: buildMorningBriefingActions({ digest, anomaly }),
    // Per-source drilldown payloads (briefing-cloudflare/github/posthog.html).
    // Null when no source produced drilldown-grade data; the screen falls back
    // to the inline card highlights.
    drilldowns: normalizeMorningBriefingDrilldowns(drilldowns || {}),
    sync: {
      sources: (digest.sources || []).map((source) => ({
        id: source.id,
        label: source.label,
        state: source.state,
        selected: Boolean(source.selected),
        detail: cleanString(source.detail, 120),
      })),
      readyCount,
      syncedAt: generatedAt,
      syncedAtLabel: timeLabel(generatedAt),
    },
    status: {
      state: readyCount > 0 ? "ready" : "empty",
      detail: readyCount > 0
        ? `소스 ${readyCount}개에서 밤사이 신호를 모았어요.`
        : "연결된 소스가 없어요. Settings > Integrations에서 소스를 연결해 주세요.",
    },
    metrics: extractMorningBriefingMetrics({ sources: digest.sources || [] }),
    // Most-recent-first list of previous briefing dates so the screen's
    // "지난 브리핑" group can render without shipping full historical payloads.
    historyDates: priorHistory
      .map((entry) => String(entry?.date || ""))
      .filter(Boolean)
      .sort()
      .slice(-7)
      .reverse(),
    // Same list with the persisted headline/day so the rows can show what each
    // morning actually said (briefing.html "지난 브리핑" rows carry titles).
    historyEntries: priorHistory
      .filter((entry) => entry?.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(-7)
      .reverse()
      .map((entry) => ({
        date: String(entry.date),
        day: finiteNumber(entry.day),
        title: cleanString(entry.title, 80) || null,
      })),
  };
}

export function labelMorningBriefingAnomaly(briefing, label, { now = new Date() } = {}) {
  const cleaned = cleanString(label, 60);
  if (!briefing?.anomaly || !cleaned) return briefing;
  return {
    ...briefing,
    anomaly: {
      ...briefing.anomaly,
      label: cleaned,
      labeledAt: nowIso(now),
    },
  };
}

// ── Persistence ──────────────────────────────────────────────────────────────

export function resolveMorningBriefingPath(workspaceRoot) {
  return path.join(path.resolve(String(workspaceRoot || ".")), ".agentic30", MORNING_BRIEFING_FILE);
}

export async function loadMorningBriefingStore({ workspaceRoot, fsImpl = fs } = {}) {
  const filePath = resolveMorningBriefingPath(workspaceRoot);
  try {
    const raw = await fsImpl.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== MORNING_BRIEFING_SCHEMA_VERSION) {
      return { schemaVersion: MORNING_BRIEFING_SCHEMA_VERSION, current: null, previous: null, history: [] };
    }
    return {
      schemaVersion: MORNING_BRIEFING_SCHEMA_VERSION,
      current: parsed.current ?? null,
      previous: parsed.previous ?? null,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { schemaVersion: MORNING_BRIEFING_SCHEMA_VERSION, current: null, previous: null, history: [] };
  }
}

export async function persistMorningBriefing({ workspaceRoot, briefing, fsImpl = fs } = {}) {
  const store = await loadMorningBriefingStore({ workspaceRoot, fsImpl });
  const date = localDateKey(briefing?.generatedAt || "");
  const currentDate = localDateKey(store.current?.generatedAt || "");
  // "어제 브리핑": the last briefing from a *different* local date stays viewable.
  // A same-date re-collect replaces current without demoting it to previous.
  const previous = store.current && currentDate && currentDate !== date
    ? store.current
    : store.previous ?? null;
  const history = [
    ...store.history.filter((entry) => entry?.date && entry.date !== date),
    ...(date
      ? [{
          date,
          metrics: briefing?.metrics || {},
          day: briefing?.day ?? null,
          // First clause of the overnight statement = the morning's headline.
          title: cleanString(String(briefing?.summary?.statement || "").split(/(?<=[.!?요])\s/)[0] || "", 80),
        }]
      : []),
  ]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-MORNING_BRIEFING_HISTORY_LIMIT);
  const next = {
    schemaVersion: MORNING_BRIEFING_SCHEMA_VERSION,
    current: briefing ?? null,
    previous,
    history,
  };
  const filePath = resolveMorningBriefingPath(workspaceRoot);
  if (fsImpl !== fs) {
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    await fsImpl.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
    return next;
  }
  await atomicWriteJson(filePath, next);
  return next;
}

export async function updatePersistedMorningBriefing({ workspaceRoot, update, fsImpl = fs } = {}) {
  const store = await loadMorningBriefingStore({ workspaceRoot, fsImpl });
  if (!store.current) return null;
  const updated = update(store.current);
  if (!updated) return null;
  const next = { ...store, current: updated };
  const filePath = resolveMorningBriefingPath(workspaceRoot);
  if (fsImpl !== fs) {
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    await fsImpl.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
    return updated;
  }
  await atomicWriteJson(filePath, next);
  return updated;
}

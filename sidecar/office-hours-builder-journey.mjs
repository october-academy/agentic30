// Builder journey — the Phase 6 relationship-closing, ported from the gstack
// office-hours 4-tier handoff (SKILL.md "Phase 6: Handoff") but reframed for the
// October Academy Partner. The relationship deepens with the number of sessions:
//
//   introduction (session 1)   — full intro: signal reflection + golden-age framing
//   welcome_back (sessions 2-3) — lead with recognition, no pitch
//   regular      (sessions 4-7) — arc-level reflection, design trajectory, journey doc
//   inner_circle (sessions 8+)  — the data speaks, full accumulated signals, journey doc
//
// Pure builders only (no I/O, no state). They emit READ-ONLY prompt guidance — the
// model writes the actual Korean prose; this never asks a card. October Academy
// Partner Voice: no YC / Garry Tan / Y Combinator, Agentic Garage + agentic30.app/blog.

export const BUILDER_JOURNEY_TIERS = Object.freeze([
  "introduction",
  "welcome_back",
  "regular",
  "inner_circle",
]);

export const AGENTIC_GARAGE_URL = "https://luma.com/agentic_garage?period=past";
export const AGENTIC30_BLOG_URL = "https://agentic30.app/blog";

export function resolveBuilderJourneyTier(sessionCount = 1) {
  const n = Number.isFinite(sessionCount) ? Math.max(0, Math.floor(sessionCount)) : 0;
  if (n <= 1) return "introduction";
  if (n <= 3) return "welcome_back";
  if (n <= 7) return "regular";
  return "inner_circle";
}

// Pure: derive builder-journey inputs from office-hours memory with an HONEST mapping.
// `sessionInProgress` true during a live interview (the cycle is not yet appended, so the
// current session is cycles.length + 1); false right after a cycle closes (cycles.length is
// the just-completed session number). designTitles is the arc of real COMMITMENTS — only
// success cycles' lastAssignment — and NEVER cycle.note (the avoidance-confession slot), so
// a confession is never reframed as design progress.
export function deriveBuilderJourneyInputs(memory = {}, { sessionInProgress = true } = {}) {
  const cycles = Array.isArray(memory?.cycles) ? memory.cycles : [];
  const lastCycle = cycles[cycles.length - 1] || {};
  return {
    sessionCount: cycles.length + (sessionInProgress ? 1 : 0),
    designTitles: cycles
      .filter((cycle) => cycle?.outcome === "success")
      .map((cycle) => String(cycle?.lastAssignment || "").trim())
      .filter(Boolean),
    lastAssignment: String(lastCycle.lastAssignment || "").trim(),
    accumulatedSignals: String(memory?.compiledTruth?.text || "").trim(),
  };
}

function cleanText(value) {
  return String(value ?? "").replace(/[ \t]+/g, " ").trim();
}

function asLines(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item)).filter(Boolean);
  const text = cleanText(value);
  return text ? [text] : [];
}

const SHARED_VOICE_RULES = [
  "Anti-slop: 일반 칭찬 금지. 이번/지난 세션에서 사용자가 실제로 한 말이나 선택을 구체적으로 인용해 되짚는다.",
  "October Academy Partner로서 닫는다. YC, Y Combinator, Garry Tan, ycombinator.com은 절대 언급하지 않는다.",
  `함께 만드는 빌더 모임 Agentic Garage(${AGENTIC_GARAGE_URL}) 참여를 한 문장으로 권한다.`,
  `빌더 리소스로 ${AGENTIC30_BLOG_URL} 를 한 줄로 안내한다.`,
  "em dash 없이 직설적인 OA Partner Voice를 유지한다. 새 structured input 카드는 만들지 않는다(prose로만 닫는다).",
];

function tierBeats(tier, { sessionCount, lastAssignment, designTitles, accumulatedSignals }) {
  const titles = asLines(designTitles);
  const lastTitle = titles.length ? titles[titles.length - 1] : "";
  const firstTitle = titles.length ? titles[0] : "";
  switch (tier) {
    case "introduction":
      return [
        "이번이 첫 office hours다. 전체 소개를 한다.",
        "Beat 1: 이번 세션에서 사용자가 보여준 구체적 사고(인용)를 짚고, 지금이 1인 빌더의 황금기라는 점을 한 문단으로 엮는다.",
        "Beat 2: 줄바꿈 후 '하나만 더.'로 주의를 환기한다.",
        "Beat 3: OA Partner로서 짧은 권유 — 지금 보여준 결정력/구체성이 빌더에게 필요한 자질이라고 짚고 Agentic Garage를 권한다.",
      ];
    case "welcome_back":
      return [
        `다시 온 사용자다(세션 ${cleanText(sessionCount) || "2-3"}). 인사보다 인식으로 먼저 연다.`,
        lastAssignment ? `지난번 약속을 먼저 짚는다: "${cleanText(lastAssignment)} — 어떻게 됐어?"` : "지난번 작업을 먼저 짚고 근황을 묻는다.",
        "이미 아는 사이이므로 큰 권유는 반복하지 않는다. 작업 이야기로 바로 들어간다.",
        "짧은 signal reflection 후 마무리한다.",
      ];
    case "regular":
      return [
        `반복 사용자다(세션 ${cleanText(sessionCount) || "4-7"}). 세션 수를 인정하며 연다.`,
        firstTitle && lastTitle && firstTitle !== lastTitle
          ? `설계 궤적을 짚는다: 처음엔 "${firstTitle}", 지금은 "${lastTitle}".`
          : "여러 세션에 걸친 패턴(특정 사용자 명명, 전제 반박 등)을 인용해 짚는다.",
        accumulatedSignals ? `누적 신호를 보여준다: ${cleanText(accumulatedSignals)}.` : "누적 신호(구체 사용자 명명 횟수, 전제 반박 횟수 등)를 짚는다.",
        "세션 5회 이상이면 builder-journey 누적 문서를 narrative arc로 갱신한다.",
      ];
    case "inner_circle":
    default:
      return [
        `핵심 사용자다(세션 ${cleanText(sessionCount) || "8+"}). 데이터가 말하게 둔다 — 권유는 필요 없다.`,
        "누적 신호 전체 요약을 보여준다.",
        "builder-journey 누적 문서를 narrative arc로 갱신한다.",
      ];
  }
}

// Read-only Phase 6 closing GUIDANCE for the system prompt. Tiered by session count.
export function buildOfficeHoursBuilderJourneyContext({
  sessionCount = 1,
  lastAssignment = "",
  designTitles = [],
  accumulatedSignals = "",
} = {}) {
  const tier = resolveBuilderJourneyTier(sessionCount);
  const beats = tierBeats(tier, { sessionCount, lastAssignment, designTitles, accumulatedSignals });
  return [
    `## Phase 6 builder-journey 마무리 (tier: ${tier} · 읽기 전용 가이드)`,
    ...beats.map((line) => `- ${line}`),
    ...SHARED_VOICE_RULES.map((line) => `- ${line}`),
  ].join("\n");
}

// The cumulative builder-journey document — a second-person narrative arc (NOT a
// data table) referencing specifics across sessions. Returns markdown.
export function buildBuilderJourneyDoc({
  sessionCount = 1,
  designTitles = [],
  accumulatedSignals = "",
  lastAssignment = "",
  now = "",
} = {}) {
  const tier = resolveBuilderJourneyTier(sessionCount);
  const titles = asLines(designTitles);
  const lines = [
    "# Builder Journey",
    "",
    `> tier: ${tier} · sessions: ${cleanText(sessionCount) || "1"}${now ? ` · updated: ${cleanText(now)}` : ""}`,
    "",
    "## 지금까지의 흐름",
  ];
  if (titles.length > 1) {
    lines.push(`처음 너는 "${titles[0]}"에서 시작했고, 지금은 "${titles[titles.length - 1]}"까지 왔다.`);
  } else if (titles.length === 1) {
    lines.push(`너는 "${titles[0]}"로 시작했다.`);
  } else {
    lines.push("아직 누적된 설계 제목이 없다. 첫 회차의 결정부터 기록한다.");
  }
  if (accumulatedSignals) {
    lines.push("", "## 누적 신호", cleanText(accumulatedSignals));
  }
  if (lastAssignment) {
    lines.push("", "## 다음 행동", cleanText(lastAssignment));
  }
  return lines.join("\n");
}

// Morning briefing per-card live progress.
//
// 수집(특히 외부 MCP digest)은 분 단위로 걸린다. 그동안 카드가 빈 화면이면
// 사용자는 멈춘 것으로 인식한다 — 카드별 스피너 + 에이전트 로그를 라이브로
// 스트리밍해 "지금 무엇을 하고 있는지"를 보여 준다.
//
// 설계 규약:
// - emit마다 전체 스냅샷(cards 배열)을 내보낸다. Swift는 dict 교체만 하면
//   되고 부분 갱신 레이스가 없다.
// - 카드 id는 브리핑 카드 id(cloudflare/github/posthog)와 1:1 — 뷰 매핑이 곧다.
// - begin되지 않은 카드에 대한 log/tool/finish는 무시한다(미연결 카드에
//   유령 스피너 방지).
// - 진행 상태는 서빙 전용이며 절대 persist하지 않는다.

const MORNING_BRIEFING_PROGRESS_LOG_LIMIT = 8;

function tailToolSegment(name = "") {
  const parts = String(name || "").split("__").filter(Boolean);
  return parts[parts.length - 1] || String(name || "");
}

// onToolEvent({ phase, toolName, payload }) → 사용자에게 보여 줄 한국어 한 줄.
// MCP 도구 사용(use)만 로그화한다 — thinking/result/usage는 노이즈이고,
// 비-MCP 도구는 digest read-only 정책이 거부하므로 사용자 로그에서 제외.
export function describeMorningBriefingToolEvent(event = {}) {
  if (event?.phase !== "use") return null;
  const name = String(event.toolName || "").trim();
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const namespace = String(payload.namespace || "").trim();
  const server = String(payload.server || "").trim();
  const tool = String(payload.tool || payload.requestedToolName || "").trim();
  const displayName = name || tool;
  const combined = [name, namespace, server, tool].filter(Boolean).join(" ");
  if (!combined) return null;
  if (/^tool[-_ ]?search$/i.test(displayName) || /^tool[-_ ]?search$/i.test(tool)) return "MCP 도구 검색";
  const lower = combined.toLowerCase();
  if (lower.includes("posthog")) {
    if (lower.includes("execute-sql") || lower.includes("query")) return "PostHog 집계 쿼리 실행";
    return `PostHog 도구 호출 · ${tailToolSegment(displayName)}`;
  }
  if (lower.includes("cloudflare")) {
    if (lower.includes("graphql")) return "Cloudflare GraphQL Analytics 조회";
    if (lower.includes("execute")) return "Cloudflare Analytics 조회";
    return `Cloudflare 도구 호출 · ${tailToolSegment(displayName)}`;
  }
  if (lower.includes("mcp__")) return `MCP 도구 호출 · ${tailToolSegment(displayName)}`;
  return null;
}

export function createMorningBriefingProgressTracker({ emit = () => {}, now = () => new Date() } = {}) {
  const cards = new Map();

  const currentDate = () => {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  };
  const stamp = () => {
    const date = currentDate();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };

  function snapshot() {
    return {
      at: currentDate().toISOString(),
      cards: [...cards.values()].map((card) => ({ ...card, logLines: [...card.logLines] })),
    };
  }

  const push = () => emit(snapshot());

  function begin(id, detail = "") {
    const key = String(id || "").trim();
    if (!key) return;
    const card = cards.get(key) || { id: key, state: "collecting", detail: "", logLines: [] };
    card.state = "collecting";
    if (detail) card.detail = String(detail);
    cards.set(key, card);
    push();
  }

  function log(id, line = "") {
    const card = cards.get(String(id || "").trim());
    const text = String(line || "").trim();
    if (!card || !text) return;
    card.logLines.push(`${stamp()} ${text}`);
    if (card.logLines.length > MORNING_BRIEFING_PROGRESS_LOG_LIMIT) {
      card.logLines.splice(0, card.logLines.length - MORNING_BRIEFING_PROGRESS_LOG_LIMIT);
    }
    push();
  }

  function tool(id, event) {
    const line = describeMorningBriefingToolEvent(event);
    if (line) log(id, line);
  }

  function finish(id, { state = "done", detail = "" } = {}) {
    const card = cards.get(String(id || "").trim());
    if (!card) return;
    card.state = state === "failed" ? "failed" : "done";
    if (detail) card.detail = String(detail);
    push();
  }

  // refresh 전체가 죽었을 때: 아직 수집 중이던 카드만 failed로 마감한다.
  function failAll(detail = "") {
    let touched = false;
    for (const card of cards.values()) {
      if (card.state !== "collecting") continue;
      card.state = "failed";
      if (detail) card.detail = String(detail);
      touched = true;
    }
    if (touched) push();
  }

  return { begin, log, tool, finish, failAll, snapshot };
}

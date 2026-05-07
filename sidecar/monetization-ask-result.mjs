/**
 * monetization-ask result.md generator (Sub-AC 3 of AC 12).
 *
 * Day 6 of the Foundation Phase forces the creator through a 4-turn loop
 * (target → draft → sent → response) defined in
 *   - monetization-ask-prompt.mjs : turn descriptors + transition rules
 *   - monetization-ask-state.mjs  : state machine + capture aggregation
 *
 * This module is the THIRD half of Day 6: when the state machine closes the
 * `response` turn it has to flush the conversation into a structured markdown
 * artifact at:
 *
 *     workspace/.agentic30/foundation/monetization-ask-result.md
 *
 * Day 7's foundation-summary sub-workflow then reads that file via
 * foundation-summary/evidence-collector.mjs to drive the go/no-go decision.
 *
 * Hard requirements:
 *
 *  1. The body MUST be parseable by evidence-collector.mjs without changes.
 *     Specifically:
 *       parseMonetizationClassification — first match of the regex
 *         /response[_\s-]*classification\s*[:=]\s*"?(yes|no_reply|maybe|no)"?/i
 *       countMonetizationYes              — counts list-item or
 *         "response_classification: yes" lines
 *       parsePaymentExecuted              — regex
 *         /payment[_\s-]*executed\s*[:=]\s*"?(true|false|yes|no)"?/i
 *     We emit those keys as canonical leading list items so the parser locks
 *     onto them first, before any verbatim quote lines that might mention
 *     the same word.
 *
 *  2. Pure rendering: no clock, no fs, no network when the caller only wants
 *     a string. The writer wrapper is a thin fs adapter.
 *
 *  3. YC partner tone is preserved in section labels — direct, no fluff,
 *     반말. No emoji, no apology, no "이상으로 마칩니다".
 *
 *  4. Resilient to partial state — if the state machine is closed but a
 *     capture is missing (rare; transition rules require them) the renderer
 *     prints "(미기록)" instead of inventing values. KR4.1/4.2 traceability
 *     forbids fabrication.
 *
 *  5. The file lives at exactly the path the FOUNDATION_DAYS[6].artifacts
 *     descriptor advertises — no rename, no nested dir.
 *
 * Two entry points:
 *   - renderMonetizationAskResultMarkdown(state, opts?) → string (pure)
 *   - writeMonetizationAskResult({ workspaceRoot, state, fs, now }) →
 *       Promise<{ path, body }> (writes to disk, returns artifact path)
 */

import nodeFs from "node:fs/promises";
import path from "node:path";

import {
  MONETIZATION_ASK_TURNS,
  MONETIZATION_ASK_META,
  getMonetizationAskTurn,
} from "./monetization-ask-prompt.mjs";

/**
 * Schema version of the rendered markdown artifact. Bumped when the on-disk
 * shape changes incompatibly. Foundation-summary evidence-collector pins to
 * the regex-stable subset (response_classification + payment_executed) so it
 * survives schema bumps as long as those two keys stay in the canonical
 * leading-list-item position.
 */
export const MONETIZATION_ASK_RESULT_SCHEMA_VERSION = 1;

/** Default artifact filename — matches FOUNDATION_DAYS[6].artifacts[0]. */
export const MONETIZATION_ASK_RESULT_FILENAME = MONETIZATION_ASK_META.artifact;

/** Foundation directory prefix relative to a workspace root. */
const FOUNDATION_REL_DIR = path.join(".agentic30", "foundation");

/** Canonical placeholder for unrecorded values — visible to humans, neutral
 *  to regex parsers (no `yes`/`no`/`true`/`false` substring collisions). */
const MISSING_VALUE = "(미기록)";

/** Order in which we render captures inside a turn block — matches the order
 *  the turn descriptor declares in monetization-ask-prompt.mjs.
 *  Keeping this consistent with the prompt schema makes the artifact a
 *  faithful 1-1 mirror of the workflow. */
const TURN_CAPTURE_ORDER = Object.freeze({
  target: ["target_name", "target_role", "target_context", "why_this_person"],
  draft: ["draft_text", "price_amount", "promise_delivered", "response_deadline"],
  sent: ["sent_at", "sent_channel", "sent_evidence_ref"],
  response: [
    "response_verbatim",
    "response_classification",
    "payment_executed",
    "follow_up_needed",
  ],
});

/** Cap rendered fields so a misbehaving capture cannot blow up the artifact.
 *  The state-machine already truncates user responses at 4000 chars; this is
 *  a second guard for arbitrary capture strings. */
const MAX_CAPTURE_RENDER_CHARS = 4000;
const MAX_USER_RESPONSE_RENDER_CHARS = 4000;

/** Capture keys that are reported authoritatively in the header block. We
 *  intentionally suppress these from the per-turn capture list so the
 *  evidence-collector regex
 *    /response[_\s-]*classification\s*[:=]\s*"?yes"?/g
 *  matches exactly ONCE per artifact (the header line), preventing
 *  Day-7 yes-count double-counting that would skew the go/no-go decision.
 *  The values still appear inside the JSON aggregate block at the bottom,
 *  but JSON's quoted-key syntax does not match the parser's regex. */
const HEADER_AUTHORITATIVE_CAPTURE_KEYS = Object.freeze(
  new Set(["response_classification", "payment_executed"]),
);

/**
 * Render the markdown body for a (terminal-or-not) monetization-ask state.
 *
 * The renderer accepts both completed and partial states so the caller can
 * persist a "draft" snapshot mid-workflow if the user abandons. The header
 * `status` field telegraphs whether the run was finalized.
 *
 * @param {object} state - state-machine output from
 *   `applyUserTurnResponse().state` (or `createInitialMonetizationAskState`).
 * @param {object} [opts]
 * @param {() => Date} [opts.now] - clock injection for the
 *   `generated_at` timestamp. Defaults to `new Date()`.
 * @returns {string} markdown body, never null.
 */
export function renderMonetizationAskResultMarkdown(state, { now = () => new Date() } = {}) {
  const safeState = normalizeStateForRender(state);
  const lines = [];

  lines.push("# monetization-ask 결과 (Day 6)");
  lines.push("");
  lines.push(
    "> Foundation Phase Day 6 — 1명 named target에게 명시적 결제 요청 후 응답을 verbatim으로 캡처. " +
      "웨이팅리스트 / 관심 표명 / 무료 가입은 monetization proof 아니야.",
  );
  lines.push("");

  // ───────────── header — keep classification + payment lines TOPMOST so
  //                evidence-collector regex anchors before any quoted text
  //                later in the body that might also contain the words yes/no.
  const aggregate = safeState.capturesAggregate || {};
  const classification = pickClassification(aggregate);
  const paymentExecuted = pickPaymentExecuted(aggregate);
  const yesCount =
    classification === "yes" ? 1 : 0; // foundation-summary then re-counts via regex

  lines.push(`- workflow: ${MONETIZATION_ASK_META.name}`);
  lines.push(`- day: ${MONETIZATION_ASK_META.day}`);
  lines.push(`- schema_version: ${MONETIZATION_ASK_RESULT_SCHEMA_VERSION}`);
  lines.push(`- persona: ${MONETIZATION_ASK_META.persona}`);
  lines.push(`- template: ${MONETIZATION_ASK_META.template}`);
  lines.push(`- status: ${safeState.completedAt ? "completed" : "in_progress"}`);
  lines.push(`- started_at: ${safeState.startedAt || MISSING_VALUE}`);
  lines.push(`- completed_at: ${safeState.completedAt || MISSING_VALUE}`);
  lines.push(`- generated_at: ${nowIso(now)}`);
  lines.push(`- total_turns: ${MONETIZATION_ASK_META.total_turns}`);
  lines.push(`- response_classification: ${classification ?? MISSING_VALUE}`);
  lines.push(`- response_yes_count: ${yesCount}`);
  lines.push(
    `- payment_executed: ${
      paymentExecuted === null || paymentExecuted === undefined
        ? MISSING_VALUE
        : String(Boolean(paymentExecuted))
    }`,
  );
  lines.push(`- target_name: ${stringifyValue(aggregate.target_name)}`);

  lines.push("");
  lines.push("## 4-turn 진행 요약");
  for (const turn of MONETIZATION_ASK_TURNS) {
    const closure = (safeState.turnHistory || []).find((entry) => entry?.id === turn.id) || null;
    const advanced = Boolean(closure);
    const isCurrent = !advanced && safeState.turn === turn.id;
    const tag = advanced ? "✓ closed" : isCurrent ? "→ 현재" : "· 미진입";
    const attempts = closure?.attemptCount ?? (isCurrent ? safeState.attemptCount || 0 : 0);
    lines.push(`- ${turn.order}. ${turn.id} (${turn.label}) — ${tag}, attempts=${attempts}`);
  }
  lines.push("");

  // ───────────── per-turn detail blocks
  for (const turn of MONETIZATION_ASK_TURNS) {
    lines.push(...renderTurnBlock(turn, safeState));
    lines.push("");
  }

  // ───────────── aggregated captures (machine-readable JSON for KR4.2 cross-check)
  lines.push("## Captures aggregate");
  lines.push("");
  lines.push("```json");
  lines.push(safeJsonStringify(aggregate));
  lines.push("```");
  lines.push("");

  // ───────────── anti-pattern checklist (mirrors MONETIZATION_ASK_META.invariants)
  lines.push("## Anti-pattern check");
  lines.push("- 웨이팅리스트는 monetization proof 아님.");
  lines.push("- 관심 표명 / \"재밌다\" / \"나중에 살게\"는 proof 아님.");
  lines.push("- 무료 가입 / 무료 체험만은 proof 아님 (이후 결제 합의 없으면).");
  lines.push("- 응답은 요약·해석 금지, verbatim 그대로.");
  lines.push("- 타겟은 1명 named individual, 집합명사·페르소나 금지.");
  lines.push("");

  // ───────────── traceability footer (KR4.1 / KR4.2)
  lines.push("## Traceability");
  lines.push(
    `- last_pushback_reason: ${
      safeState.lastPushbackReason ? safeState.lastPushbackReason : "(없음)"
    }`,
  );
  lines.push(`- attempt_count_at_close: ${safeState.attemptCount || 0}`);
  if (Array.isArray(safeState.turnHistory) && safeState.turnHistory.length) {
    const total = safeState.turnHistory.reduce(
      (sum, entry) => sum + (entry?.attemptCount || 0),
      0,
    );
    lines.push(`- total_attempts_across_turns: ${total}`);
  } else {
    lines.push("- total_attempts_across_turns: 0");
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Persist the rendered markdown to
 *   `<workspaceRoot>/.agentic30/foundation/monetization-ask-result.md`.
 *
 * Side effects:
 *  - Creates the foundation directory recursively if missing.
 *  - Writes the file with mode 0600 (matches the evidence-refs sidecar
 *    in foundation-chat.mjs — user data, not world-readable).
 *
 * @param {object} args
 * @param {string} args.workspaceRoot - absolute project root.
 * @param {object} args.state         - monetization-ask state-machine state.
 * @param {object} [args.fs]          - `node:fs/promises`-shaped override
 *                                      (tests inject a mock).
 * @param {() => Date} [args.now]     - clock injection.
 * @returns {Promise<{ path: string, body: string }>}
 */
export async function writeMonetizationAskResult({
  workspaceRoot,
  state,
  fs = nodeFs,
  now = () => new Date(),
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("writeMonetizationAskResult: workspaceRoot is required");
  }
  const dir = path.join(workspaceRoot, FOUNDATION_REL_DIR);
  const filePath = path.join(dir, MONETIZATION_ASK_RESULT_FILENAME);
  const body = renderMonetizationAskResultMarkdown(state, { now });

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, body, { mode: 0o600 });

  return { path: filePath, body };
}

/* ──────────────────── internal renderers ──────────────────── */

function renderTurnBlock(turn, safeState) {
  const closure =
    (safeState.turnHistory || []).find((entry) => entry?.id === turn.id) || null;
  const isCurrent = !closure && safeState.turn === turn.id;
  const status = closure ? "advanced" : isCurrent ? "in_progress" : "未進入";
  const lines = [];
  lines.push(`## Turn ${turn.order} — ${turn.label} (${turn.id})`);
  lines.push("");
  lines.push(`- core_question: ${turn.core_question}`);
  lines.push(`- status: ${status}`);
  lines.push(
    `- attempts: ${
      closure?.attemptCount ?? (isCurrent ? safeState.attemptCount || 0 : 0)
    }`,
  );
  lines.push(`- transitioned_at: ${closure?.transitionedAt || MISSING_VALUE}`);
  if (turn.transition?.next) {
    lines.push(`- next: ${turn.transition.next}`);
  } else {
    lines.push("- next: (terminal)");
  }
  lines.push("");

  // captures table — turn-scoped subset of the aggregate. We suppress
  // header-authoritative keys (response_classification, payment_executed)
  // here so the evidence-collector parser counts them once, not per-section.
  const order = TURN_CAPTURE_ORDER[turn.id] || turn.captures || [];
  const captures = closure?.captures || pickTurnCaptures(turn.id, safeState.capturesAggregate);
  const renderableEntries = [];
  if (captures && typeof captures === "object") {
    for (const key of order) {
      if (HEADER_AUTHORITATIVE_CAPTURE_KEYS.has(key)) continue;
      if (captures[key] === undefined) continue;
      renderableEntries.push([key, captures[key]]);
    }
    const known = new Set(order);
    for (const key of Object.keys(captures)) {
      if (known.has(key)) continue;
      if (HEADER_AUTHORITATIVE_CAPTURE_KEYS.has(key)) continue;
      renderableEntries.push([key, captures[key]]);
    }
  }
  lines.push("- captures:");
  if (renderableEntries.length === 0) {
    lines.push(`  - ${MISSING_VALUE}`);
  } else {
    for (const [key, value] of renderableEntries) {
      lines.push(`  - ${key}: ${stringifyValue(value)}`);
    }
  }
  lines.push("");

  // verbatim user response (truncated for safety, fenced so quoted reply text
  // cannot accidentally bait a regex match against header keys)
  if (closure?.userResponse) {
    lines.push("- 사용자 답변:");
    lines.push("");
    lines.push("```text");
    lines.push(truncate(String(closure.userResponse), MAX_USER_RESPONSE_RENDER_CHARS));
    lines.push("```");
  } else if (isCurrent) {
    lines.push("- 사용자 답변: (이 턴에서 아직 advance 못함)");
  } else {
    lines.push(`- 사용자 답변: ${MISSING_VALUE}`);
  }

  return lines;
}

/* ──────────────────── helpers ──────────────────── */

function normalizeStateForRender(state) {
  if (!state || typeof state !== "object") {
    return {
      turn: "target",
      startedAt: null,
      completedAt: null,
      turnHistory: [],
      capturesAggregate: {},
      attemptCount: 0,
      lastPushbackReason: null,
    };
  }
  return {
    turn: typeof state.turn === "string" ? state.turn : "target",
    startedAt: typeof state.startedAt === "string" ? state.startedAt : null,
    completedAt: typeof state.completedAt === "string" ? state.completedAt : null,
    turnHistory: Array.isArray(state.turnHistory) ? state.turnHistory : [],
    capturesAggregate:
      state.capturesAggregate && typeof state.capturesAggregate === "object"
        ? state.capturesAggregate
        : {},
    attemptCount: Number.isFinite(state.attemptCount) ? state.attemptCount : 0,
    lastPushbackReason:
      typeof state.lastPushbackReason === "string" ? state.lastPushbackReason : null,
  };
}

function pickClassification(aggregate) {
  const value = aggregate?.response_classification;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!MONETIZATION_ASK_META.classification_values.includes(normalized)) return null;
  return normalized;
}

function pickPaymentExecuted(aggregate) {
  const value = aggregate?.payment_executed;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "no") return false;
  }
  return null;
}

function pickTurnCaptures(turnId, aggregate) {
  const order = TURN_CAPTURE_ORDER[turnId] || [];
  const out = {};
  for (const key of order) {
    if (aggregate?.[key] !== undefined) {
      out[key] = aggregate[key];
    }
  }
  return out;
}

function stringifyValue(value) {
  if (value === null || value === undefined || value === "") return MISSING_VALUE;
  if (typeof value === "string") return truncate(value, MAX_CAPTURE_RENDER_CHARS);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : MISSING_VALUE;
  try {
    return truncate(JSON.stringify(value), MAX_CAPTURE_RENDER_CHARS);
  } catch {
    return MISSING_VALUE;
  }
}

function truncate(value, max) {
  if (typeof value !== "string") return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function nowIso(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return value;
    return new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/* ──────────────────── re-exports for callers that only import this ──────────────────── */

export {
  MONETIZATION_ASK_META,
  MONETIZATION_ASK_TURNS,
  getMonetizationAskTurn,
};

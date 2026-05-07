import fs from "node:fs/promises";
import path from "node:path";

/**
 * Foundation Phase Day 0-7 metadata.
 *
 * Each day binds:
 * - core_question: the fixed Phase question creator must answer that day
 * - input_sources: which workspace inputs the AI may pull from
 * - sub_workflow: optional internal sub-workflow hint (NOT exposed to caller)
 * - spec_version: which SPEC.md vN this day produces (or null)
 * - artifacts: .md files written under workspace/.agentic30/foundation/
 * - first_prompt: AI-driven daily opener in 3-section minimal template
 *     {yesterday: 1줄, today: 1줄, question: 1줄}
 *     Dynamic variables are written as `{var_name}` and replaced at runtime
 *     by buildFirstPromptForDay(). Tone: YC 파트너 / 시니어 메이커
 *     (직설+압박, 반말 ~어/야). No 정서적 지지 sugar. No fluff.
 *
 * Sub-workflow selection happens INSIDE the unified channel based on day +
 * prompt content. The caller never sees a mode flag — it only sends a chat
 * message and the day index.
 */
export const FOUNDATION_DAYS = Object.freeze({
  0: {
    day: 0,
    core_question: "BIP/ICP/SPEC 채널을 어떻게 등록할 거야?",
    input_sources: ["path"],
    sub_workflow: "bip-channel-register",
    spec_version: null,
    artifacts: ["day-0-channel-setup.md"],
    first_prompt: Object.freeze({
      yesterday: "어제 없어. 오늘이 Day 0 — Foundation 시작점이야.",
      today: "BIP/ICP/SPEC 채널 등록하고 4종 인풋(프로젝트 path, 업무 일지, 인터뷰 transcript, BIP 일지) 경로 박아.",
      question: "어디서부터 등록할 건데? 채널 1개 + 인풋 1개 골라서 지금 답해.",
    }),
  },
  1: {
    day: 1,
    core_question: "고객의 어제 행동에서 가장 압축된 통증 1개는 뭐야?",
    input_sources: ["path", "work_log", "interview", "bip"],
    sub_workflow: "office-hours-docs",
    spec_version: "v0",
    artifacts: ["SPEC.md", "day-1-pain-summary.md"],
    first_prompt: Object.freeze({
      yesterday: "어제 채널 등록 끝냈어. runway {runway}, 과거 실패 {past_failures} — 이거 잊지 마.",
      today: "4종 인풋에서 가장 압축된 통증 1개만 뽑아 SPEC.md v0 박아. 통증 2개 이상이면 실패야.",
      question: "그 통증, 누가 어제 어떤 행동으로 보여줬어? 가정 말고 행동.",
    }),
  },
  2: {
    day: 2,
    core_question: "어제 가설을 강화/약화할 데이터가 어디서 나왔어?",
    input_sources: ["work_log", "interview", "bip"],
    sub_workflow: null,
    spec_version: null,
    artifacts: ["day-2-evidence-log.md"],
    first_prompt: Object.freeze({
      yesterday: "어제 SPEC v0 썼어. 가설 ID {weak_hypothesis_id} 가장 약해.",
      today: "오늘 24시간 안에 그 가설 강화/약화할 데이터 어디서 끌어올 거야? 인터뷰/일지/BIP 중 명시.",
      question: "강화 1개 + 반증 1개 — 둘 다 못 찾으면 가설 다시 짜. 어느 쪽 먼저?",
    }),
  },
  3: {
    day: 3,
    core_question: "약한 가설을 5문장으로 검증/반증할 인터뷰 질문 만들었어?",
    input_sources: ["interview", "bip", "work_log"],
    sub_workflow: "office-hours-docs",
    spec_version: "v1",
    artifacts: ["SPEC.md", "day-3-interview-script.md"],
    first_prompt: Object.freeze({
      yesterday: "어제 가설 {weak_hypothesis_id} {validated_or_refuted}. 데이터 {n_quotes}건.",
      today: "검증/반증할 인터뷰 질문 5문장 — Mom Test 그대로. 미래 의향 묻는 문장 0개여야 해.",
      question: "5문장 중 과거 행동 묻는 게 몇 개야? 3개 미만이면 다시 써.",
    }),
  },
  4: {
    day: 4,
    core_question: "지난 24시간 신호로 어떤 섹션을 다시 쓸 거야?",
    input_sources: ["work_log", "interview"],
    sub_workflow: null,
    spec_version: null,
    artifacts: ["day-4-rewrite-decision.md"],
    first_prompt: Object.freeze({
      yesterday: "어제 인터뷰 {n_quotes}건 끝났어. 약한 섹션은 {weak_section}, 이유는 {reason}.",
      today: "그 섹션 지금 다시 써. SPEC.md 같은 파일에서 덮어쓰기 — 새 파일 만들지 마.",
      question: "다시 쓴 뒤, 어느 부분이 가설 약화시키는 데이터로 바뀌었어? 1줄로 답해.",
    }),
  },
  5: {
    day: 5,
    core_question: "광고/노출 데이터에서 진짜 수요 시그널은 뭐야?",
    input_sources: ["path", "work_log"],
    sub_workflow: "analyze-ads",
    spec_version: "v2",
    artifacts: ["SPEC.md", "day-5-demand-signal.md"],
    first_prompt: Object.freeze({
      yesterday: "어제 약한 섹션 {weak_section} 다시 썼어.",
      today: "광고 데이터 — impressions {impressions}, clicks {clicks}, signups {signups} — 진짜 수요 시그널 {signal_strength} 평가해서 SPEC.md v2 박아.",
      question: "waitlist도 CTR도 매출 아니야. 진짜 돈 낼 1명 후보 누구야?",
    }),
  },
  6: {
    day: 6,
    core_question: "오늘 누구한테 돈 내달라고 명시적으로 물어볼 거야?",
    input_sources: ["interview", "work_log", "bip"],
    sub_workflow: "monetization-ask",
    spec_version: null,
    artifacts: ["monetization-ask-result.md"],
    first_prompt: Object.freeze({
      yesterday: "어제 광고 시그널 {signal_strength} 잡았어. 이제 가설은 데이터로 받쳐졌어.",
      today: "오늘 누구한테 돈 내달라고 명시적으로 물어볼 거야 — 1명 이름 + 오퍼 가격 + ask 문장 적어.",
      question: "결과는 yes 받아 / no 받아 / 답 못 받아 셋 중 하나야. 끝나면 어느 쪽으로 보고할 건데?",
    }),
  },
  7: {
    day: 7,
    core_question: "Foundation 7일 결과 — 계속 / 재시작 / 피벗 중 무엇이고 근거는?",
    input_sources: ["path", "work_log", "interview", "bip"],
    sub_workflow: "foundation-summary",
    spec_version: "v3",
    artifacts: ["SPEC.md", "go-no-go.md", "foundation-summary.md"],
    first_prompt: Object.freeze({
      yesterday: "어제 monetization ask 끝났어. 강한 섹션 {strong_section}, 약한 섹션 {weak_section_v3}.",
      today: "Foundation 7일 결과 — 계속 / 재시작 / 피벗 중 하나 골라 go-no-go.md 작성하고 SPEC.md v3 박아.",
      question: "monetization yes 0건이면 피벗인가, 재시작인가? 근거 1문장 적어.",
    }),
  },
});

const PERSONA = "YC 파트너 / 시니어 메이커 (직설+압박, 반말 ~어/야)";

/**
 * Foundation Phase day-length and total-span constants.
 *
 * Mirrors the Swift `AgenticViewModel.foundationDayNumber` formula
 *   D_swift = floor((now - started_at) / 86_400) + 1   (1-based, capped 1..30)
 * but normalized to the 0-based Foundation index this module's
 * `FOUNDATION_DAYS` map uses (Day 0..7 inclusive).
 *
 * The relationship is:
 *   foundationDay = D_swift - 1   for D_swift ∈ [1, 8]
 *   = floor(elapsedMs / 86_400_000) when elapsedMs ∈ [0, 8 * 86_400_000)
 *
 * `started_at` is the wall-clock anchor written when the user crosses the
 * onboarding gate (`mac_foundation_phase_started`) — it is locked once set
 * and survives reboots.
 */
export const FOUNDATION_DAY_MS = 86_400_000; // 24 hours in ms
export const FOUNDATION_TOTAL_DAYS = 8; // Day 0..7 inclusive
export const FOUNDATION_MAX_DAY_INDEX = FOUNDATION_TOTAL_DAYS - 1; // 7

/**
 * Compute the current Foundation Phase day (0–7) from a `started_at` anchor.
 *
 * Returns `null` outside the Foundation window so callers can distinguish
 * "before start" / "post-Foundation" from a valid Day 0 — `getFoundationDay`
 * accepts only that 0..7 range, so any non-null return from this function
 * is guaranteed to round-trip through it.
 *
 * Boundary policy (deliberately mirrors the Swift contract while staying
 * honest about clock skew so KR4.1/4.2 evidence stays trustworthy):
 *
 *   • missing / invalid `startedAt`              → `null`
 *   • non-finite or unparsable `now`             → `null`
 *   • now < startedAt (clock skew or pre-start)  → `0`   (clamped first day)
 *   • 0 ≤ elapsedMs < 8 days                     → `0..7` (floor)
 *   • elapsedMs ≥ 8 days                         → `null` (Build phase, OOR)
 *
 * The clock-skew clamp matches the Swift `max(1, …)` floor so a brief
 * negative delta right after `ensureFoundationStarted()` still yields a
 * usable Day 0 instead of a `null` that would surface as an error.
 *
 * Accepted timestamp shapes: ISO-8601 string, `Date` instance, epoch ms.
 *
 * @param {string|number|Date|null|undefined} startedAt - Foundation anchor.
 * @param {string|number|Date}                [now]     - Optional clock
 *        override (defaults to wall clock — tests pin this).
 * @returns {number|null} Foundation day index in `[0, 7]`, or `null` when
 *          the timestamp is unusable or the user is outside the phase.
 */
export function computeFoundationDayFromStartedAt(startedAt, now = new Date()) {
  const startedMs = normalizeFoundationTimestampMs(startedAt);
  if (startedMs === null) return null;
  const nowMs = normalizeFoundationTimestampMs(now);
  if (nowMs === null) return null;
  const elapsedMs = nowMs - startedMs;
  if (elapsedMs < 0) return 0; // clamp clock skew / pre-start to Day 0
  const day = Math.floor(elapsedMs / FOUNDATION_DAY_MS);
  if (day < 0) return 0; // defensive — keeps the contract total
  if (day > FOUNDATION_MAX_DAY_INDEX) return null; // Day 8+ = Build phase
  return day;
}

/**
 * Resolve the current Foundation day for an inbound chat payload.
 *
 * Resolution priority (first valid wins):
 *   1. Explicit `payload.day` from the Swift host (it is the user-visible
 *      counter — trust it when in range so the UI badge and the sidecar
 *      log agree).
 *   2. `payload.foundationStartedAt` (ISO string forwarded by the host) —
 *      lets the sidecar verify or recompute when day is missing/stale.
 *   3. `null` when neither is usable — the caller emits a rejection event.
 *
 * Always returns one of: integer 0..7, or `null`. Never throws.
 */
export function resolveFoundationDayFromPayload(payload = {}, now = new Date()) {
  const explicit = Number(payload?.day);
  if (Number.isFinite(explicit)) {
    const trimmed = Math.trunc(explicit);
    if (trimmed >= 0 && trimmed <= FOUNDATION_MAX_DAY_INDEX) {
      return trimmed;
    }
  }
  const computed = computeFoundationDayFromStartedAt(
    payload?.foundationStartedAt ?? payload?.startedAt ?? null,
    now,
  );
  if (computed !== null) return computed;
  return null;
}

/**
 * Normalize an ISO-8601 string / `Date` / epoch ms into milliseconds.
 * Returns `null` for any input the caller should treat as "no anchor".
 * Empty strings, NaN, ±Infinity, and non-Date objects all collapse to null
 * so the day computation stays a pure function with no exception surface.
 */
function normalizeFoundationTimestampMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Allowed dynamic variable keys for first_prompt placeholder substitution.
 * Mirrors the Agentic30FoundationPhase ontology (dynamic_variables).
 */
const ALLOWED_DYNAMIC_VARS = Object.freeze([
  "runway",
  "past_failures",
  "weak_hypothesis_id",
  "validated_or_refuted",
  "n_quotes",
  "weak_section",
  "reason",
  "impressions",
  "clicks",
  "signups",
  "signal_strength",
  "strong_section",
  "weak_section_v3",
]);

/**
 * Fallback rendered when a `{var}` placeholder is missing in dynamicVariables.
 * Stays honest about gaps instead of inventing values — the AI must press the
 * creator to fill them in. (KR4.1/4.2 evidence integrity.)
 */
const MISSING_VAR_PLACEHOLDER = "(아직 데이터 없음)";

/**
 * Normalize the day index into the Foundation 0-7 range.
 * Returns a frozen day descriptor or null when out of range.
 */
export function getFoundationDay(dayInput) {
  if (dayInput === undefined || dayInput === null || dayInput === "") return null;
  const dayNum = Number(dayInput);
  if (!Number.isFinite(dayNum)) return null;
  const day = Math.trunc(dayNum);
  if (day < 0 || day > 7) return null;
  return FOUNDATION_DAYS[day] || null;
}

/**
 * Substitute `{var}` placeholders inside `template` using `vars` map.
 * Unknown / nullish values fall back to MISSING_VAR_PLACEHOLDER so the YC
 * partner tone never invents numbers. Whitelist-only — keys outside
 * ALLOWED_DYNAMIC_VARS are ignored.
 */
function renderTemplate(template, vars) {
  if (typeof template !== "string" || template.length === 0) return "";
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (!ALLOWED_DYNAMIC_VARS.includes(key)) return match;
    const value = vars?.[key];
    if (value === undefined || value === null || value === "") {
      return MISSING_VAR_PLACEHOLDER;
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return MISSING_VAR_PLACEHOLDER;
      }
    }
    return String(value);
  });
}

/**
 * Build the AI-driven daily first prompt for a given Foundation day.
 *
 * Returns the 3-section minimal object (yesterday / today / question) with
 * dynamic variables substituted, plus light metadata so the chat surface can
 * tag it as Day N's opener. Returns null when the day is out of range.
 *
 * The shape matches the Agentic30FoundationPhase ontology's
 * `first_prompt: {yesterday, today, question}` concept exactly.
 *
 * @param {object} args
 * @param {number|string} args.day - Foundation day index (0-7).
 * @param {object}        [args.dynamicVariables] - Runtime extracted vars
 *        (runway, past_failures, weak_hypothesis_id, validated_or_refuted,
 *         n_quotes, weak_section, reason, impressions, clicks, signups,
 *         signal_strength, strong_section, weak_section_v3).
 * @returns {{
 *   day: number,
 *   persona: string,
 *   template: "3-section minimal",
 *   yesterday: string,
 *   today: string,
 *   question: string,
 *   core_question: string,
 *   spec_version: string|null,
 *   sub_workflow: string|null,
 *   artifacts: string[],
 *   text: string,
 * } | null}
 */
export function buildFirstPromptForDay({ day, dynamicVariables = {} } = {}) {
  const descriptor = getFoundationDay(day);
  if (!descriptor) return null;
  const tpl = descriptor.first_prompt;
  if (!tpl) return null;

  const vars = dynamicVariables && typeof dynamicVariables === "object" ? dynamicVariables : {};
  const rendered = {
    yesterday: renderTemplate(tpl.yesterday, vars),
    today: renderTemplate(tpl.today, vars),
    question: renderTemplate(tpl.question, vars),
  };

  return {
    day: descriptor.day,
    persona: PERSONA,
    template: "3-section minimal",
    ...rendered,
    core_question: descriptor.core_question,
    spec_version: descriptor.spec_version ?? null,
    sub_workflow: descriptor.sub_workflow ?? null,
    artifacts: [...(descriptor.artifacts || [])],
    text: formatFirstPromptText(rendered),
  };
}

/**
 * Format the 3-section minimal first prompt as plain text the way the chat
 * surface should render it. Stable layout — Yesterday / Today / Q on three
 * separate lines, no extra fluff, no emoji. Used as both the visible chat
 * message AND a fingerprint for deduplication.
 */
export function formatFirstPromptText(prompt) {
  if (!prompt) return "";
  const yesterday = String(prompt.yesterday || "").trim();
  const today = String(prompt.today || "").trim();
  const question = String(prompt.question || "").trim();
  const lines = [];
  if (yesterday) lines.push(`어제: ${yesterday}`);
  if (today) lines.push(`오늘: ${today}`);
  if (question) lines.push(`Q: ${question}`);
  return lines.join("\n");
}

/**
 * Resolve unified Foundation context for the chat channel.
 * NOTE: This is intentionally a single resolver — the caller never receives a
 * mode flag. Sub-workflow hints stay inside the context object so the
 * provider stream sees them only as system context, not as a branching tag.
 */
export function resolveFoundationContext({
  day,
  prompt = "",
  workspace = {},
  dynamicVariables = {},
  evidenceRefs = [],
} = {}) {
  const descriptor = getFoundationDay(day);
  const trimmedPrompt = String(prompt || "").trim();
  const variables = sanitizeDynamicVariables(dynamicVariables);
  const refs = sanitizeEvidenceRefs(evidenceRefs);

  return {
    day: descriptor?.day ?? null,
    core_question: descriptor?.core_question ?? null,
    input_sources: descriptor?.input_sources ?? [],
    sub_workflow: descriptor?.sub_workflow ?? null,
    spec_version: descriptor?.spec_version ?? null,
    artifacts: descriptor?.artifacts ?? [],
    persona: PERSONA,
    template: "3-section minimal (Yesterday 1줄 / Today 1줄 / Q 1줄)",
    workspace_root: typeof workspace.root === "string" ? workspace.root : "",
    dynamic_variables: variables,
    evidence_refs: refs,
    prompt: trimmedPrompt,
    overall_confidence: computeOverallConfidence({ refs, variables, descriptor }),
    missing_inputs: computeMissingInputs({ descriptor, workspace }),
  };
}

/**
 * Build a unified system context block for the AI provider.
 * Only ONE channel is used — every day, every sub-workflow, the same surface.
 */
export function buildFoundationSystemContext(context) {
  if (!context || context.day === null) return "";
  const lines = [];
  lines.push("# Agentic30 Foundation 코파운더 컨텍스트");
  lines.push(`- Day: ${context.day}/7`);
  lines.push(`- Persona: ${context.persona}`);
  lines.push(`- Template: ${context.template}`);
  if (context.core_question) {
    lines.push(`- Core Question: ${context.core_question}`);
  }
  if (context.spec_version) {
    lines.push(`- SPEC 산출물: SPEC.md ${context.spec_version}`);
  }
  if (Array.isArray(context.artifacts) && context.artifacts.length) {
    lines.push(`- Day 산출물: ${context.artifacts.join(", ")}`);
  }
  if (Array.isArray(context.input_sources) && context.input_sources.length) {
    lines.push(`- 활용 인풋: ${context.input_sources.join(", ")}`);
  }
  if (context.sub_workflow) {
    lines.push(`- 내부 sub-workflow 힌트: ${context.sub_workflow} (응답 톤/포커스에만 반영, 분기 없음)`);
  }
  if (context.dynamic_variables && Object.keys(context.dynamic_variables).length) {
    lines.push("- Dynamic Variables:");
    for (const [key, value] of Object.entries(context.dynamic_variables)) {
      lines.push(`  - ${key}: ${formatVariable(value)}`);
    }
  }
  if (Array.isArray(context.evidence_refs) && context.evidence_refs.length) {
    lines.push(`- Evidence Refs (count=${context.evidence_refs.length}):`);
    for (const ref of context.evidence_refs.slice(0, 8)) {
      lines.push(`  - ${ref.ref_type || "unknown"} :: ${ref.file || "?"} :: ${ref.field_used || ""}`);
    }
  }
  if (Array.isArray(context.missing_inputs) && context.missing_inputs.length) {
    lines.push("- Missing Inputs:");
    for (const item of context.missing_inputs) {
      lines.push(`  - ${item.expected} → fallback=${item.fallback_used || "none"}`);
    }
  }
  lines.push("");
  lines.push("## 응답 규칙");
  lines.push("- 어제 1줄 / 오늘 1줄 / Q 1줄, 그 외는 직설적 단문.");
  lines.push("- 정서적 지지/응원 sugar 금지. YC 파트너 톤 유지.");
  lines.push("- 숫자 + 과거 행동 + 반증 데이터 강제. 미래 vibes 차단.");
  lines.push("- 사용자가 모드를 선택할 일은 없어. 단일 채팅 surface 안에서 컨텍스트로만 응답해.");
  return lines.join("\n");
}

/**
 * Compose the final prompt sent to the provider through the SINGLE AI
 * interaction channel. This is the only place we glue Foundation context
 * with the user's raw prompt — there is no mode-based branching.
 */
export function composeUnifiedFoundationPrompt({
  context,
  bipContextBlock = "",
  workspaceManifest = "",
} = {}) {
  if (!context || context.day === null) {
    return context?.prompt ?? "";
  }
  const systemContext = buildFoundationSystemContext(context);
  const sections = [];
  if (systemContext) sections.push(systemContext);
  if (workspaceManifest) sections.push(workspaceManifest);
  if (bipContextBlock) sections.push(bipContextBlock);
  sections.push("## User Message");
  sections.push(context.prompt || "");
  return sections.filter(Boolean).join("\n\n");
}

/**
 * Persist evidence_refs as a JSON sidecar to enable KR4.1/4.2 measurement.
 * Sidecar lives under workspace/.agentic30/foundation/evidence/<sessionId>/.
 */
export async function persistEvidenceRefsSidecar({
  workspaceRoot,
  sessionId,
  messageId,
  day,
  context,
}) {
  if (!workspaceRoot || !sessionId || !messageId) return null;
  const baseDir = path.join(
    workspaceRoot,
    ".agentic30",
    "foundation",
    "evidence",
    String(sessionId),
  );
  await fs.mkdir(baseDir, { recursive: true });
  const filePath = path.join(baseDir, `${messageId}.json`);
  const payload = {
    schema_version: 1,
    session_id: sessionId,
    message_id: messageId,
    day: day ?? context?.day ?? null,
    persona: PERSONA,
    captured_at: new Date().toISOString(),
    sub_workflow: context?.sub_workflow ?? null,
    spec_version: context?.spec_version ?? null,
    overall_confidence: context?.overall_confidence ?? 0,
    dynamic_variables: context?.dynamic_variables ?? {},
    evidence_refs: context?.evidence_refs ?? [],
    missing_inputs: context?.missing_inputs ?? [],
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return filePath;
}

function sanitizeDynamicVariables(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const allowed = [
    "runway",
    "past_failures",
    "weak_hypothesis_id",
    "validated_or_refuted",
    "n_quotes",
    "weak_section",
    "reason",
    "impressions",
    "clicks",
    "signups",
    "signal_strength",
    "strong_section",
    "weak_section_v3",
  ];
  const out = {};
  for (const key of allowed) {
    if (input[key] !== undefined && input[key] !== null) {
      out[key] = input[key];
    }
  }
  return out;
}

function sanitizeEvidenceRefs(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      file: typeof entry.file === "string" ? entry.file : "",
      location: typeof entry.location === "string" ? entry.location : "",
      field_used: typeof entry.field_used === "string" ? entry.field_used : "",
      extracted_value: entry.extracted_value ?? null,
      ref_type: typeof entry.ref_type === "string" ? entry.ref_type : "unknown",
    }));
}

function computeOverallConfidence({ refs, variables, descriptor }) {
  if (!descriptor) return 0;
  const wantedSources = descriptor.input_sources || [];
  if (wantedSources.length === 0) return 0;
  const havePathRef = refs.some((ref) => ref.ref_type === "path" || ref.ref_type === "file");
  const haveWorkLog = refs.some((ref) => ref.ref_type === "work_log");
  const haveInterview = refs.some((ref) => ref.ref_type === "interview");
  const haveBip = refs.some((ref) => ref.ref_type === "bip");
  const presence = {
    path: havePathRef,
    work_log: haveWorkLog,
    interview: haveInterview,
    bip: haveBip,
  };
  const matched = wantedSources.filter((source) => presence[source]).length;
  let score = wantedSources.length > 0 ? matched / wantedSources.length : 0;
  if (variables && Object.keys(variables).length >= 2) {
    score = Math.min(1, score + 0.1);
  }
  return Math.round(score * 100) / 100;
}

function computeMissingInputs({ descriptor, workspace }) {
  if (!descriptor) return [];
  const out = [];
  for (const source of descriptor.input_sources || []) {
    const present = workspace?.available_sources?.includes?.(source);
    if (!present) {
      out.push({
        expected: source,
        fallback_used: workspace?.fallbacks?.[source] || null,
      });
    }
  }
  return out;
}

function formatVariable(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

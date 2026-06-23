export const MORNING_BRIEFING_VERDICT_STATES = Object.freeze([
  "instrumentation_gap",
  "build_without_customer_evidence",
  "traffic_without_activation",
  "healthy",
]);

const REQUIRED_SOURCE_REFS = Object.freeze(["cloudflare", "github", "posthog"]);
const MAX_PROMPT_CHARS = 12_000;
const MAX_FACT_CHARS = 260;
const MAX_FACTS_PER_SOURCE = 18;
const ACTIVE_USERS_REQUIRED_FROM_DAY = 14;
const FRESH_MS = 24 * 60 * 60 * 1000;
const EXPIRED_MS = 72 * 60 * 60 * 1000;

const SOURCE_CLASSES = Object.freeze({
  cloudflare: "distribution",
  github: "build_ship",
  posthog: "customer_behavior",
  proof_ledger: "customer_behavior",
  active_users: "customer_behavior",
  program_gates: "program_gate",
  evidence_os: "customer_evidence_debt",
  work_history: "diagnostic",
  adaptive_rules: "diagnostic",
});

const COMPLETED_PROOF_STATUSES = new Set(["accepted", "verified", "complete", "completed"]);
const CUSTOMER_PROOF_TYPES = new Set([
  "interview",
  "dm_ask",
  "payment_intent",
  "payment_record",
  "action_evidence",
]);
const CUSTOMER_PROOF_STRENGTHS = new Set(["medium", "strong"]);

const RAW_IDENTIFIER_PATTERNS = Object.freeze([
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bph[xa]_[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b(?:person|user|distinct|account|workspace|session|device)[_-]?[A-Za-z0-9]{10,}\b/gi,
  /\b[0-9a-f]{24,}\b/gi,
]);

const GROUNDING_STOPWORDS = new Set([
  "그리고", "하지만", "오늘", "근거", "신호", "확인", "있습니다", "없습니다",
  "기준", "먼저", "이후", "동안", "상태", "고객", "행동", "검증", "증거",
  "source", "state", "ready", "counts", "summary", "detail",
]);

export class MorningBriefingVerdictError extends Error {
  constructor(code, message, fields = {}) {
    super(message);
    this.name = "MorningBriefingVerdictError";
    this.code = code;
    Object.assign(this, fields);
  }
}

function cleanString(value = "", max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanMultiline(value = "", max = 1200) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDay(value) {
  const number = finiteNumber(value);
  if (number === null) return null;
  const day = Math.trunc(number);
  return day >= 1 && day <= 400 ? day : null;
}

function safeText(value = "", max = 240) {
  let text = cleanString(value, max);
  for (const pattern of RAW_IDENTIFIER_PATTERNS) {
    text = text.replace(new RegExp(pattern.source, pattern.flags), "[redacted]");
  }
  return text.replace(/\b(raw rows?|full query results?|stack traces?)\b/gi, "[redacted]").trim();
}

function safeMultiline(value = "", max = 1200) {
  let text = cleanMultiline(value, max);
  for (const pattern of RAW_IDENTIFIER_PATTERNS) {
    text = text.replace(new RegExp(pattern.source, pattern.flags), "[redacted]");
  }
  return text.replace(/\b(raw rows?|full query results?|stack traces?)\b/gi, "[redacted]").trim();
}

function hasUnsafeRawIdentifier(value = "") {
  const text = String(value ?? "");
  return RAW_IDENTIFIER_PATTERNS.some((pattern) => new RegExp(pattern.source, pattern.flags).test(text));
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function entriesOf(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
    : [];
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values = [], max = 20, charLimit = 120) {
  const output = [];
  for (const value of toArray(values)) {
    const text = safeText(value, charLimit);
    if (text && !output.includes(text)) output.push(text);
    if (output.length >= max) break;
  }
  return output;
}

function sourceClassFor(sourceId = "") {
  return SOURCE_CLASSES[sourceId] || "aggregate_source";
}

function classifyFreshness(checkedAt, now = new Date()) {
  const timestamp = Date.parse(String(checkedAt || ""));
  if (!Number.isFinite(timestamp)) return "missing";
  const ageMs = now.getTime() - timestamp;
  if (!Number.isFinite(ageMs) || ageMs < 0) return "fresh";
  if (ageMs <= FRESH_MS) return "fresh";
  if (ageMs <= EXPIRED_MS) return "stale";
  return "expired";
}

function addFact(facts, value, max = MAX_FACT_CHARS) {
  const text = safeText(value, max);
  if (text && !facts.includes(text)) facts.push(text);
}

function numericCounts(counts = {}, maxEntries = 12) {
  const output = {};
  for (const [key, value] of entriesOf(counts)) {
    const number = finiteNumber(value);
    if (number === null) continue;
    output[safeText(key, 60)] = number;
    if (Object.keys(output).length >= maxEntries) break;
  }
  return output;
}

function countFacts(label, counts = {}) {
  return entriesOf(counts)
    .filter(([, value]) => finiteNumber(value) !== null)
    .map(([key, value]) => `${label} ${safeText(key, 80)} ${Number(value)}`);
}

function sourceById(sources = []) {
  return new Map(toArray(sources).map((source) => [source?.id, source]));
}

function cardById(cards = []) {
  return new Map(toArray(cards).map((card) => [card?.id, card]));
}

function sourceReady(source) {
  return source?.state === "ready";
}

function sourceCollectionStatus(source = {}, card = null) {
  return {
    state: safeText(source?.state || card?.state || "missing", 30),
    selected: Boolean(source?.selected),
    summary: safeText(source?.summary || card?.note || source?.detail || "", 180),
    detail: safeText(source?.detail || "", 180),
  };
}

function compactRows(rows = []) {
  return toArray(rows)
    .map((row) => {
      const key = safeText(row?.k ?? row?.key ?? row?.label, 80);
      const value = safeText(row?.v ?? row?.value ?? row?.valueLabel, 120);
      return key && value ? `${key}: ${value}` : "";
    })
    .filter(Boolean)
    .slice(0, 8);
}

function compactKpis(kpis = []) {
  return toArray(kpis)
    .map((kpi) => {
      const label = safeText(kpi?.label, 80);
      const value = safeText(kpi?.valueLabel ?? kpi?.value, 120);
      return label && value ? `${label}: ${value}` : "";
    })
    .filter(Boolean)
    .slice(0, 8);
}

function compactFunnelSteps(steps = []) {
  return toArray(steps)
    .map((step) => {
      const label = safeText(step?.label || step?.id, 80);
      const value = safeText(step?.valueLabel ?? step?.value, 80);
      const status = safeText(step?.status, 40);
      const source = safeText(step?.source, 60);
      return [source, label, value, status].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .slice(0, 8);
}

function buildGroupedSourceEvidence({ groupId, digest = {}, briefing = {} }) {
  const byId = sourceById(digest.sources || []);
  const cards = cardById(briefing.cards || []);
  const drilldowns = briefing.drilldowns || {};
  const funnelSteps = toArray(briefing.evidenceFunnel?.steps);

  const sourceIds = groupId === "github" ? ["git", "gh_cli", "github"] : [groupId];
  const rawSources = sourceIds.map((id) => byId.get(id)).filter(Boolean);
  const ready = groupId === "github"
    ? rawSources.some(sourceReady)
    : sourceReady(rawSources[0]);
  const representative = rawSources.find(sourceReady) || rawSources[0] || {};
  const card = cards.get(groupId) || null;
  const drilldown = drilldowns?.[groupId] || null;
  const label = groupId === "github"
    ? "GitHub"
    : safeText(representative.label || card?.label || groupId, 80);
  const counts = rawSources.reduce((acc, source) => ({
    ...acc,
    ...numericCounts(source?.counts || {}),
  }), {});
  const facts = [];
  addFact(facts, `${label} collection state ${representative.state || card?.state || "missing"}`);
  for (const source of rawSources) {
    addFact(facts, source?.summary, 180);
    for (const line of toArray(source?.highlights).slice(0, 6)) addFact(facts, `${label}: ${line}`, 180);
    for (const line of toArray(source?.goalSignals).slice(0, 4)) addFact(facts, `${label} goal signal: ${line}`, 180);
    for (const line of toArray(source?.evidenceGaps).slice(0, 4)) addFact(facts, `${label} evidence gap: ${line}`, 180);
    for (const line of countFacts(label, source?.counts || {})) addFact(facts, line, 160);
  }
  for (const row of compactRows(card?.rows || [])) addFact(facts, `${label} card row ${row}`, 160);
  for (const kpi of compactKpis(drilldown?.kpis || [])) addFact(facts, `${label} KPI ${kpi}`, 160);
  for (const row of compactRows(drilldown?.meta?.rows || [])) addFact(facts, `${label} meta ${row}`, 160);
  for (const step of compactFunnelSteps(
    funnelSteps.filter((step) => safeText(step?.source, 60).toLowerCase().includes(label.toLowerCase())),
  )) {
    addFact(facts, `${label} funnel ${step}`, 160);
  }

  return {
    id: groupId,
    label,
    state: ready ? "ready" : safeText(representative.state || card?.state || "missing", 40),
    ready,
    collectionStatus: sourceCollectionStatus(representative, card),
    summary: safeText(representative.summary || card?.note || "", 220),
    counts,
    highlights: toArray(rawSources.flatMap((source) => toArray(source?.highlights)))
      .map((line) => safeText(line, 160))
      .filter(Boolean)
      .slice(0, 8),
    cardRows: compactRows(card?.rows || []),
    drilldownKpis: compactKpis(drilldown?.kpis || []),
    drilldownRows: compactRows(drilldown?.meta?.rows || []),
    funnel: compactFunnelSteps(
      funnelSteps.filter((step) => safeText(step?.source, 60).toLowerCase().includes(label.toLowerCase())),
    ),
    facts: facts.slice(0, MAX_FACTS_PER_SOURCE),
  };
}

function hasSourceEvidence(source) {
  return Boolean(
    source?.ready
      && (
        Object.keys(source.counts || {}).length
        || toArray(source.highlights).length
        || toArray(source.cardRows).length
        || toArray(source.drilldownKpis).length
        || toArray(source.funnel).length
        || toArray(source.facts).length > 1
      ),
  );
}

function normalizeClaim(value = {}) {
  const raw = objectOrEmpty(value);
  const sourceId = safeText(raw.sourceId || raw.source_id, 80);
  const summary = safeText(raw.summary, 320);
  if (!sourceId || !summary) return null;
  const id = safeText(raw.id, 100) || `${sourceId}_${Math.abs(summary.length)}`;
  const checkedAt = safeText(raw.checkedAt ?? raw.checked_at, 80);
  const freshness = safeText(raw.freshness, 30) || (checkedAt ? classifyFreshness(checkedAt) : "missing");
  return {
    id,
    sourceId,
    sourceClass: safeText(raw.sourceClass ?? raw.source_class, 80) || sourceClassFor(sourceId),
    tier: safeText(raw.tier, 60) || "aggregate",
    summary,
    counts: numericCounts(raw.counts || {}, 12),
    window: safeText(raw.window, 120),
    checkedAt,
    freshness,
    confidence: safeText(raw.confidence, 30) || "medium",
    customerEvidence: raw.customerEvidence === true,
    supportsHealthy: raw.supportsHealthy === true,
    missingReason: safeText(raw.missingReason ?? raw.missing_reason, 180),
    refs: uniqueStrings(raw.refs || [], 8, 180),
  };
}

function addClaim(claims, claim) {
  const normalized = normalizeClaim(claim);
  if (!normalized) return;
  if (claims.some((existing) => existing.id === normalized.id)) return;
  claims.push(normalized);
}

function sourceWindowLabel(source = {}) {
  const checkedAt = safeText(source.collectionStatus?.checkedAt || source.checkedAt, 80);
  return checkedAt ? `checked ${checkedAt}` : "";
}

// A required aggregate source that is unconnected — or connected but reporting
// no distribution data for this user — is a measurement gap, not an error. We
// record it as a low-confidence claim with a missingReason so the verdict can
// call out the gap (prompt rule: "Missing source is not zero") instead of
// aborting the whole morning-briefing refresh. The hard requirement remains the
// internal context (onboarding / Day 1 goal / Office Hours) and customer
// evidence, none of which depend on an external source being connected.
function addMissingRequiredSourceClaims(claims, sources = [], requiredRefs = REQUIRED_SOURCE_REFS) {
  for (const required of toArray(requiredRefs)) {
    const source = toArray(sources).find((candidate) => candidate?.id === required);
    if (hasSourceEvidence(source)) continue;
    const connected = Boolean(source?.ready);
    const state = safeText(source?.collectionStatus?.state || source?.state || "missing", 40);
    const label = safeText(source?.label || required, 80);
    addClaim(claims, {
      id: `source_${required}_missing`,
      sourceId: required,
      sourceClass: sourceClassFor(required),
      tier: "external_aggregate_missing",
      summary: `${label} aggregate evidence unavailable; collection state ${state}. Treat as measurement gap, not observed zero.`,
      counts: {},
      window: sourceWindowLabel(source || {}),
      freshness: "missing",
      confidence: "low",
      customerEvidence: false,
      supportsHealthy: false,
      missingReason: connected ? `${required}_connected_no_evidence` : `${required}_not_connected`,
      refs: [
        connected ? "source connected but reported no aggregate evidence" : "source not connected",
        source?.collectionStatus?.summary ? safeText(source.collectionStatus.summary, 180) : "",
      ].filter(Boolean),
    });
  }
}

function addExternalSourceClaims(claims, sources = []) {
  for (const source of toArray(sources).filter(hasSourceEvidence)) {
    const countLine = entriesOf(source.counts || {})
      .map(([key, value]) => `${safeText(key, 50)}=${value}`)
      .join(", ");
    const topFact = toArray(source.facts).find((fact) => !/collection state/i.test(fact));
    const summary = [
      `${source.label} aggregate source ready`,
      countLine,
      safeText(topFact || source.summary, 180),
    ].filter(Boolean).join("; ");
    addClaim(claims, {
      id: `source_${source.id}`,
      sourceId: source.id,
      sourceClass: sourceClassFor(source.id),
      tier: "external_aggregate",
      summary,
      counts: source.counts,
      window: sourceWindowLabel(source),
      freshness: "fresh",
      confidence: source.id === "github" ? "medium" : "high",
      customerEvidence: false,
      supportsHealthy: false,
      refs: source.facts,
    });
  }
}

function proofEventType(event = {}) {
  return safeText(event.type ?? event.eventType ?? event.event_type, 80);
}

function proofEventStatus(event = {}) {
  return safeText(event.status ?? event.validationStatus ?? event.validation_status, 80);
}

function proofEventStrength(event = {}) {
  return safeText(event.strength ?? event.proofStrength ?? event.proof_strength, 80);
}

function proofEventDay(event = {}) {
  return normalizeDay(event.day ?? event.dayNumber ?? event.day_number);
}

function proofEventCompletedMediumPlus(event = {}) {
  return CUSTOMER_PROOF_TYPES.has(proofEventType(event))
    && COMPLETED_PROOF_STATUSES.has(proofEventStatus(event))
    && CUSTOMER_PROOF_STRENGTHS.has(proofEventStrength(event));
}

function addProofLedgerClaims(claims, proofLedger = null) {
  const events = toArray(proofLedger?.events);
  const eligible = events.filter(proofEventCompletedMediumPlus);
  const byType = {};
  for (const event of eligible) {
    const type = proofEventType(event);
    byType[type] = (byType[type] || 0) + 1;
  }
  addClaim(claims, {
    id: "proof_ledger_completed_customer_evidence",
    sourceId: "proof_ledger",
    sourceClass: "customer_behavior",
    tier: "proof",
    summary: `Proof Ledger completed medium+ customer evidence count ${eligible.length}`,
    counts: {
      total: eligible.length,
      ...byType,
    },
    checkedAt: safeText(proofLedger?.updatedAt ?? proofLedger?.updated_at, 80),
    freshness: proofLedger?.updatedAt || proofLedger?.updated_at
      ? classifyFreshness(proofLedger.updatedAt ?? proofLedger.updated_at)
      : "missing",
    confidence: eligible.some((event) => proofEventStrength(event) === "strong") ? "high" : "medium",
    customerEvidence: eligible.length > 0,
    supportsHealthy: eligible.length > 0,
    refs: eligible.slice(-6).map((event) => [
      `day ${proofEventDay(event) ?? "?"}`,
      proofEventType(event),
      proofEventStatus(event),
      proofEventStrength(event),
    ].filter(Boolean).join(" ")),
  });

  const pendingOrWeak = events.filter((event) => {
    const type = proofEventType(event);
    if (!CUSTOMER_PROOF_TYPES.has(type)) return false;
    if (proofEventCompletedMediumPlus(event)) return false;
    return proofEventStatus(event) === "submitted" || proofEventStrength(event) === "weak";
  });
  if (pendingOrWeak.length) {
    addClaim(claims, {
      id: "proof_ledger_pending_or_weak",
      sourceId: "proof_ledger",
      sourceClass: "customer_behavior",
      tier: "context",
      summary: `Proof Ledger pending or weak customer signals count ${pendingOrWeak.length}`,
      counts: { total: pendingOrWeak.length },
      checkedAt: safeText(proofLedger?.updatedAt ?? proofLedger?.updated_at, 80),
      freshness: proofLedger?.updatedAt || proofLedger?.updated_at
        ? classifyFreshness(proofLedger.updatedAt ?? proofLedger.updated_at)
        : "missing",
      confidence: "low",
      customerEvidence: false,
      supportsHealthy: false,
      refs: pendingOrWeak.slice(-4).map((event) => [
        `day ${proofEventDay(event) ?? "?"}`,
        proofEventType(event),
        proofEventStatus(event),
        proofEventStrength(event),
      ].filter(Boolean).join(" ")),
    });
  }
}

function normalizeActiveUserInput(activeUsers = null) {
  const raw = objectOrEmpty(activeUsers);
  const signal = objectOrEmpty(raw.signal ?? raw.firstValue ?? raw.first_value);
  const rowCount = finiteNumber(signal.rowCount ?? signal.activeUserCount ?? signal.active_user_count);
  const checkedAt = safeText(signal.checkedAt ?? signal.at, 80);
  const eventName = safeText(signal.firstValueEventName ?? signal.first_value_event_name, 120) || "first_value";
  const collectionStatus = safeText(raw.collectionStatus?.status ?? raw.collectionStatus ?? raw.status, 80);
  return {
    hasSignal: rowCount !== null && checkedAt,
    rowCount,
    observed: signal.observed === true || (rowCount !== null && rowCount >= 1),
    checkedAt,
    eventName,
    collectionStatus,
  };
}

function addActiveUserClaim(claims, activeUsers = null, { required = false, now = new Date() } = {}) {
  const normalized = normalizeActiveUserInput(activeUsers);
  if (normalized.hasSignal) {
    const freshness = classifyFreshness(normalized.checkedAt, now);
    addClaim(claims, {
      id: "active_users_first_value",
      sourceId: "active_users",
      sourceClass: "customer_behavior",
      tier: "measurement",
      summary: `Active Users first_value unique users ${normalized.rowCount}`,
      counts: {
        firstValueUsers: normalized.rowCount,
      },
      checkedAt: normalized.checkedAt,
      freshness,
      confidence: freshness === "expired" ? "low" : "high",
      customerEvidence: false,
      supportsHealthy: normalized.rowCount >= 1 && freshness !== "expired",
      missingReason: freshness === "expired" ? "active user snapshot expired" : "",
      refs: [`event ${normalized.eventName}`, normalized.collectionStatus ? `collection ${normalized.collectionStatus}` : ""],
    });
    return {
      present: freshness !== "expired",
      satisfied: normalized.rowCount >= 1 && freshness !== "expired",
      freshness,
      status: normalized.collectionStatus,
    };
  }
  addClaim(claims, {
    id: "active_users_missing",
    sourceId: "active_users",
    sourceClass: "customer_behavior",
    tier: "measurement",
    summary: required
      ? "Active Users first_value snapshot missing or unavailable"
      : "Active Users first_value snapshot not required yet",
    counts: {},
    freshness: "missing",
    confidence: "low",
    customerEvidence: false,
    supportsHealthy: false,
    missingReason: normalized.collectionStatus || "missing_snapshot",
  });
  return {
    present: false,
    satisfied: false,
    freshness: "missing",
    status: normalized.collectionStatus,
  };
}

function relevantGate(evaluation = {}) {
  if (evaluation?.blockingGate) return evaluation.blockingGate;
  const gates = objectOrEmpty(evaluation?.gates);
  return Object.values(gates).find((gate) => gate?.state === "blocked")
    || Object.values(gates).find((gate) => gate?.state === "open")
    || Object.values(gates).find((gate) => gate?.state && gate.state !== "passed")
    || null;
}

function addProgramGateClaim(claims, evaluation = null) {
  const gate = relevantGate(evaluation);
  if (!gate) return { blocked: false };
  const requiredEvidence = toArray(gate.requiredEvidence ?? gate.required_evidence)
    .map((entry) => safeText(entry?.label || entry?.id, 180))
    .filter(Boolean)
    .slice(0, 5);
  const sourceUnavailable = toArray(gate.conditions)
    .filter((condition) => condition?.sourceUnavailable === true)
    .map((condition) => safeText(condition.label || condition.id, 160))
    .filter(Boolean);
  const blocked = gate.state === "blocked";
  addClaim(claims, {
    id: "program_gate_relevant",
    sourceId: "program_gates",
    sourceClass: "program_gate",
    tier: blocked ? "gate_blocked" : "gate_status",
    summary: `Program Gate ${safeText(gate.gateId ?? gate.gate_id, 20)} ${safeText(gate.state, 40)} ${safeText(gate.blockedReason ?? gate.blocked_reason, 80)}`.trim(),
    counts: {
      unmetConditions: requiredEvidence.length,
      sourceUnavailableConditions: sourceUnavailable.length,
    },
    checkedAt: safeText(evaluation?.evaluatedAt ?? evaluation?.evaluated_at, 80),
    freshness: evaluation?.evaluatedAt || evaluation?.evaluated_at ? "fresh" : "missing",
    confidence: "high",
    customerEvidence: false,
    supportsHealthy: false,
    missingReason: blocked ? safeText(gate.blockedReason ?? gate.blocked_reason, 120) : "",
    refs: [...requiredEvidence, ...sourceUnavailable],
  });
  return { blocked };
}

function addEvidenceOsClaim(claims, evidenceOS = null) {
  if (!evidenceOS || typeof evidenceOS !== "object") return { overdueDebtCount: 0 };
  const openDebts = toArray(evidenceOS.openDebts);
  const overdueDebts = toArray(evidenceOS.overdueDebts);
  const provenEvidence = toArray(evidenceOS.provenEvidence);
  const dayStates = objectOrEmpty(evidenceOS.dayStates);
  const currentDay = normalizeDay(evidenceOS.currentDay ?? evidenceOS.current_day);
  const currentDayState = currentDay ? dayStates[String(currentDay)] : null;
  addClaim(claims, {
    id: "evidence_os_debt_status",
    sourceId: "evidence_os",
    sourceClass: "customer_evidence_debt",
    tier: "debt_status",
    summary: `Evidence OS open debts ${openDebts.length}; overdue debts ${overdueDebts.length}; proven evidence ${provenEvidence.length}`,
    counts: {
      openDebts: openDebts.length,
      overdueDebts: overdueDebts.length,
      provenEvidence: provenEvidence.length,
    },
    freshness: "fresh",
    confidence: "high",
    customerEvidence: false,
    supportsHealthy: false,
    missingReason: overdueDebts.length ? "overdue_evidence_debt" : "",
    refs: [
      currentDayState?.state ? `current day state ${currentDayState.state}` : "",
      currentDayState?.carryForwardAction ? `carry forward ${currentDayState.carryForwardAction}` : "",
    ],
  });
  return { overdueDebtCount: overdueDebts.length };
}

function addWorkHistoryClaim(claims, workHistory = null) {
  const totals = objectOrEmpty(workHistory?.totals);
  const sessionCount = finiteNumber(totals.sessionCount) ?? 0;
  const myCommitCount = finiteNumber(totals.myCommitCount) ?? 0;
  const aiMinutes = finiteNumber(totals.aiMinutes) ?? 0;
  const unclassifiedCount = toArray(workHistory?.unclassified).length;
  if (!sessionCount && !myCommitCount && !aiMinutes && !unclassifiedCount) return;
  addClaim(claims, {
    id: "work_history_diagnostic",
    sourceId: "work_history",
    sourceClass: "diagnostic",
    tier: "diagnostic",
    summary: `Work History diagnostic AI sessions ${sessionCount}; commits ${myCommitCount}; unclassified ${unclassifiedCount}`,
    counts: {
      sessionCount,
      myCommitCount,
      aiMinutes,
      unclassifiedCount,
    },
    checkedAt: safeText(workHistory?.generatedAt ?? workHistory?.generated_at, 80),
    freshness: workHistory?.generatedAt || workHistory?.generated_at
      ? classifyFreshness(workHistory.generatedAt ?? workHistory.generated_at)
      : "missing",
    confidence: "medium",
    customerEvidence: false,
    supportsHealthy: false,
    refs: ["diagnostic only; never counts as customer evidence"],
  });
}

function addAdaptiveRuleClaim(claims, adaptiveRuleSignals = null) {
  const signals = objectOrEmpty(adaptiveRuleSignals?.signals ?? adaptiveRuleSignals);
  const buildEscapeDays = finiteNumber(signals.buildWithoutCustomerEvidenceDays) ?? 0;
  const weakOnlyEvidenceDays = finiteNumber(signals.weakOnlyEvidenceDays) ?? 0;
  const abandonedThreadCount = finiteNumber(signals.abandonedThreadCount) ?? 0;
  const paymentIntentCount = finiteNumber(signals.paymentIntentCount) ?? 0;
  const paymentRecordCount = finiteNumber(signals.paymentRecordCount) ?? 0;
  if (!buildEscapeDays && !weakOnlyEvidenceDays && !abandonedThreadCount && !paymentIntentCount && !paymentRecordCount) return;
  addClaim(claims, {
    id: "adaptive_rules_diagnostic",
    sourceId: "adaptive_rules",
    sourceClass: "diagnostic",
    tier: "diagnostic",
    summary: `Adaptive diagnostics build-without-customer-evidence days ${buildEscapeDays}; weak-only days ${weakOnlyEvidenceDays}; abandoned threads ${abandonedThreadCount}`,
    counts: {
      buildWithoutCustomerEvidenceDays: buildEscapeDays,
      weakOnlyEvidenceDays,
      abandonedThreadCount,
      paymentIntentCount,
      paymentRecordCount,
    },
    freshness: "fresh",
    confidence: "medium",
    customerEvidence: false,
    supportsHealthy: false,
    refs: ["diagnostic only; never counts as customer evidence"],
  });
}

export function buildMorningBriefingVerdictEvidenceBundle({
  sources = [],
  proofLedger = null,
  activeUsers = null,
  programGateEvaluation = null,
  evidenceOS = null,
  workHistory = null,
  adaptiveRuleSignals = null,
  currentDay = null,
  now = new Date(),
} = {}) {
  const claims = [];
  addExternalSourceClaims(claims, sources);
  addProofLedgerClaims(claims, proofLedger);
  const day = normalizeDay(currentDay);
  const activeUsersRequired = Boolean(day && day >= ACTIVE_USERS_REQUIRED_FROM_DAY);
  const activeUsersStatus = addActiveUserClaim(claims, activeUsers, {
    required: activeUsersRequired,
    now,
  });
  const gateStatus = addProgramGateClaim(claims, programGateEvaluation);
  const evidenceOsStatus = addEvidenceOsClaim(claims, evidenceOS);
  addWorkHistoryClaim(claims, workHistory);
  addAdaptiveRuleClaim(claims, adaptiveRuleSignals);

  const hasCompletedCustomerEvidence = claims.some((claim) => claim.customerEvidence === true);
  const activeUsersPresent = !activeUsersRequired || activeUsersStatus.present === true;
  if (activeUsersRequired && !activeUsersPresent) {
    throw new MorningBriefingVerdictError(
      "missing_active_users",
      "Morning briefing verdict requires a non-expired first_value active-user snapshot from Day 14 onward.",
      { source: "active_users" },
    );
  }
  return {
    schema: "agentic30.morning_briefing.verdict_evidence_bundle.v1",
    currentDay: day,
    claims,
    requirements: {
      activeUsersRequired,
      activeUsersPresent,
      activeUsersSatisfied: !activeUsersRequired || activeUsersStatus.satisfied === true,
      hasCompletedCustomerEvidence,
      gateBlocked: gateStatus.blocked === true,
      overdueProofDebtCount: evidenceOsStatus.overdueDebtCount || 0,
    },
  };
}

function compactOnboarding(onboardingMemory) {
  if (!onboardingMemory) return null;
  const answerLines = entriesOf(onboardingMemory.answers)
    .map(([, answer]) => {
      const question = safeText(answer?.question, 140);
      const value = safeText(answer?.answer, 220);
      const detail = safeText(answer?.detail, 220);
      if (!value && !detail) return "";
      return [question, value, detail].filter(Boolean).join(" — ");
    })
    .filter(Boolean)
    .slice(0, 8);
  const contextLines = entriesOf(onboardingMemory.onboardingContext)
    .flatMap(([key, value]) => Array.isArray(value)
      ? value.map((item) => `${key}: ${item}`)
      : [`${key}: ${value}`])
    .map((line) => safeText(line, 240))
    .filter(Boolean)
    .slice(0, 12);
  if (!answerLines.length && !contextLines.length) return null;
  return { answers: answerLines, onboardingContext: contextLines };
}

function compactDay1Goal(selection) {
  if (!selection) return null;
  const fields = {
    goalType: selection.goalType,
    goalText: selection.goalText,
    customer: selection.customer,
    problem: selection.problem,
    validationAction: selection.validationAction,
    proofSink: selection.proofSink,
    evidenceRefs: toArray(selection.evidenceRefs).join(" / "),
  };
  const lines = entriesOf(fields)
    .map(([key, value]) => safeText(`${key}: ${value}`, 300))
    .filter((line) => !line.endsWith(":"))
    .slice(0, 10);
  return lines.length ? { lines } : null;
}

function compactOfficeHours({ history, memorySummary, historyPrompt = "" } = {}) {
  const recentTurns = toArray(history?.officeHoursTurns).map((line) => safeText(line, 260)).filter(Boolean).slice(-6);
  const openCommitments = toArray(history?.openCommitments).map((line) => safeText(line, 220)).filter(Boolean).slice(0, 6);
  const metCommitments = toArray(history?.metCommitments).map((line) => safeText(line, 220)).filter(Boolean).slice(0, 6);
  const sourceReads = toArray(history?.sourceReads).map((line) => safeText(line, 220)).filter(Boolean).slice(0, 4);
  const dayRollup = toArray(history?.dayRollup)
    .map((entry) => safeText(`Day ${entry?.day || "?"}: ${entry?.summary || ""}`, 220))
    .filter(Boolean)
    .slice(-6);
  const currentDay = safeText(history?.currentDayMemory?.summary?.text, 300);
  const compiledTruth = safeText(memorySummary?.compiledTruth, 500);
  const openThreads = toArray(memorySummary?.openThreads).map((line) => safeText(line, 220)).filter(Boolean).slice(0, 5);
  const abandonedThreads = toArray(memorySummary?.abandonedThreads).map((line) => safeText(line, 220)).filter(Boolean).slice(0, 5);
  const calibrationLine = safeText(memorySummary?.calibrationLine, 180);
  const pendingPrediction = safeText(memorySummary?.pendingPrediction, 220);
  const consecutiveDeferrals = finiteNumber(memorySummary?.consecutiveDeferrals) ?? 0;
  const hasContext = recentTurns.length || openCommitments.length || metCommitments.length
    || sourceReads.length || dayRollup.length || currentDay || compiledTruth || openThreads.length
    || abandonedThreads.length || calibrationLine || pendingPrediction || consecutiveDeferrals > 0;
  if (!hasContext) return null;
  return {
    recentTurns,
    openCommitments,
    metCommitments,
    sourceReads,
    dayRollup,
    currentDay,
    compiledTruth,
    openThreads,
    abandonedThreads,
    calibrationLine,
    pendingPrediction,
    consecutiveDeferrals,
    promptSummary: safeMultiline(historyPrompt, 1400),
  };
}

function buildGroundingPhrases(context) {
  const phrases = [];
  for (const line of context.onboarding.answers || []) addFact(phrases, `온보딩 ${line}`, 260);
  for (const line of context.onboarding.onboardingContext || []) addFact(phrases, `온보딩 ${line}`, 260);
  for (const line of context.day1Goal.lines || []) addFact(phrases, `Day 1 ${line}`, 260);
  for (const key of [
    "recentTurns", "openCommitments", "metCommitments", "sourceReads", "dayRollup",
    "openThreads", "abandonedThreads",
  ]) {
    for (const line of toArray(context.officeHours[key])) addFact(phrases, `Office Hours ${line}`, 260);
  }
  for (const key of ["currentDay", "compiledTruth", "calibrationLine", "pendingPrediction"]) {
    addFact(phrases, `Office Hours ${context.officeHours[key]}`, 260);
  }
  if (context.officeHours.consecutiveDeferrals > 0) {
    addFact(phrases, `Office Hours deferrals ${context.officeHours.consecutiveDeferrals}`, 120);
  }
  for (const source of context.sources) {
    addFact(phrases, `${source.label} state ${source.state}`, 120);
    for (const [key, value] of entriesOf(source.counts || {})) {
      addFact(phrases, `${source.label} ${key} ${value}`, 120);
    }
    for (const fact of toArray(source.facts)) addFact(phrases, fact, 260);
    for (const fact of [
      ...toArray(source.highlights),
      ...toArray(source.cardRows),
      ...toArray(source.drilldownKpis),
      ...toArray(source.drilldownRows),
      ...toArray(source.funnel),
    ]) {
      addFact(phrases, `${source.label} ${fact}`, 220);
    }
  }
  for (const claim of toArray(context.evidenceBundle?.claims)) {
    addFact(phrases, `${claim.sourceId} ${claim.summary}`, 320);
    for (const [key, value] of entriesOf(claim.counts || {})) {
      addFact(phrases, `${claim.sourceId} ${key} ${value}`, 160);
    }
    for (const ref of toArray(claim.refs)) {
      addFact(phrases, `${claim.sourceId} ${ref}`, 220);
    }
  }
  for (const step of toArray(context.evidenceFunnel)) addFact(phrases, step, 180);
  return phrases;
}

export function buildMorningBriefingVerdictContext({
  onboardingMemory = null,
  day1GoalSelection = null,
  officeHoursHistory = null,
  officeHoursMemorySummary = null,
  officeHoursHistoryPrompt = "",
  digest = {},
  briefing = {},
  proofLedger = null,
  activeUsers = null,
  programGateEvaluation = null,
  evidenceOS = null,
  workHistory = null,
  adaptiveRuleSignals = null,
  currentDay = null,
  now = new Date(),
} = {}) {
  const onboarding = compactOnboarding(onboardingMemory);
  if (!onboarding) {
    throw new MorningBriefingVerdictError("missing_onboarding", "Morning briefing verdict requires onboarding answers/context.");
  }
  const day1Goal = compactDay1Goal(day1GoalSelection);
  if (!day1Goal) {
    throw new MorningBriefingVerdictError("missing_day1_goal", "Morning briefing verdict requires the Day 1 goal selection.");
  }
  const officeHours = compactOfficeHours({
    history: officeHoursHistory,
    memorySummary: officeHoursMemorySummary,
    historyPrompt: officeHoursHistoryPrompt,
  });
  if (!officeHours) {
    throw new MorningBriefingVerdictError("missing_office_hours", "Morning briefing verdict requires Office Hours memory/context.");
  }

  const sourceGroups = ["cloudflare", "github", "posthog"];
  const additionalIds = toArray(digest.sources)
    .map((source) => source?.id === "git" || source?.id === "gh_cli" ? "github" : source?.id)
    .filter((id) => id && !sourceGroups.includes(id));
  const sources = [...sourceGroups, ...Array.from(new Set(additionalIds))]
    .map((groupId) => buildGroupedSourceEvidence({ groupId, digest, briefing }));

  const actionIds = toArray(briefing.actions).map((action) => safeText(action?.id, 80)).filter(Boolean);
  if (!actionIds.length) {
    throw new MorningBriefingVerdictError("missing_actions", "Morning briefing verdict requires action drafts.");
  }
  const evidenceFunnel = compactFunnelSteps(briefing.evidenceFunnel?.steps || []);
  const resolvedCurrentDay = normalizeDay(currentDay ?? briefing.day);
  const evidenceBundle = buildMorningBriefingVerdictEvidenceBundle({
    sources,
    proofLedger,
    activeUsers,
    programGateEvaluation,
    evidenceOS,
    workHistory,
    adaptiveRuleSignals,
    currentDay: resolvedCurrentDay,
    now,
  });
  // Degrade gracefully: required aggregate sources without evidence are recorded
  // as missingReason claims instead of throwing, so an unconnected (or empty)
  // Cloudflare/GitHub/PostHog never aborts the full briefing refresh.
  addMissingRequiredSourceClaims(evidenceBundle.claims, sources);
  const contextRefs = [
    "onboarding",
    "day1_goal",
    "office_hours",
    ...REQUIRED_SOURCE_REFS,
    ...sources.filter(hasSourceEvidence).map((source) => source.id),
    ...toArray(evidenceBundle.claims).map((claim) => claim.sourceId),
  ];
  const context = {
    schema: "agentic30.morning_briefing.verdict_context.v2",
    allowedStates: [...MORNING_BRIEFING_VERDICT_STATES],
    availableActionIds: actionIds,
    contextRefs: Array.from(new Set(contextRefs)),
    currentDay: resolvedCurrentDay,
    onboarding,
    day1Goal,
    officeHours,
    sources,
    evidenceFunnel,
    evidenceBundle,
  };
  context.groundingPhrases = buildGroundingPhrases(context);
  return context;
}

function renderLines(title, lines = [], max = 10) {
  const safe = toArray(lines).map((line) => safeText(line, 260)).filter(Boolean).slice(0, max);
  if (!safe.length) return "";
  return [`${title}:`, ...safe.map((line) => `- ${line}`)].join("\n");
}

function renderSource(source) {
  const lines = [
    `### ${source.label} (${source.id})`,
    `state: ${source.state}`,
    `collection: ${source.collectionStatus.summary || source.collectionStatus.detail || source.collectionStatus.state}`,
  ];
  const countLine = entriesOf(source.counts || {})
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  if (countLine) lines.push(`counts: ${countLine}`);
  for (const section of [
    ["highlights", source.highlights],
    ["card rows", source.cardRows],
    ["drilldown kpis", source.drilldownKpis],
    ["drilldown rows", source.drilldownRows],
    ["funnel", source.funnel],
  ]) {
    const rendered = renderLines(section[0], section[1], 6);
    if (rendered) lines.push(rendered);
  }
  return lines.join("\n");
}

function renderClaim(claim) {
  const countLine = entriesOf(claim.counts || {})
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return [
    `- id=${claim.id}`,
    `source=${claim.sourceId}`,
    `class=${claim.sourceClass}`,
    `tier=${claim.tier}`,
    `freshness=${claim.freshness}`,
    `confidence=${claim.confidence}`,
    `customerEvidence=${claim.customerEvidence ? "true" : "false"}`,
    `supportsHealthy=${claim.supportsHealthy ? "true" : "false"}`,
    countLine ? `counts(${countLine})` : "",
    claim.missingReason ? `missingReason=${claim.missingReason}` : "",
    `summary=${claim.summary}`,
    toArray(claim.refs).length ? `refs=${toArray(claim.refs).join(" / ")}` : "",
  ].filter(Boolean).join("; ");
}

function renderRequirements(requirements = {}) {
  const rows = [
    `activeUsersRequired=${requirements.activeUsersRequired === true}`,
    `activeUsersPresent=${requirements.activeUsersPresent === true}`,
    `activeUsersSatisfied=${requirements.activeUsersSatisfied === true}`,
    `hasCompletedCustomerEvidence=${requirements.hasCompletedCustomerEvidence === true}`,
    `gateBlocked=${requirements.gateBlocked === true}`,
    `overdueProofDebtCount=${finiteNumber(requirements.overdueProofDebtCount) ?? 0}`,
  ];
  return rows.join("; ");
}

export function buildMorningBriefingVerdictPrompt(context = {}) {
  if (!context?.schema) {
    throw new MorningBriefingVerdictError("missing_context", "Morning briefing verdict prompt requires normalized context.");
  }
  const prompt = [
    "MORNING_BRIEFING_VERDICT_JSON",
    "You are the Agentic30 morning briefing verdict writer for a solo founder/developer.",
    "Return JSON only. Do not wrap in Markdown.",
    "",
    "Required JSON shape:",
    '{"state":"instrumentation_gap|build_without_customer_evidence|traffic_without_activation|healthy","title":"Korean visible title","body":"Korean visible body","primaryActionId":"one available action id","evidence":["2-4 grounded Korean bullets"]}',
    "",
    "Rules:",
    "- Judge the day using onboarding answers/context, Day 1 goal, Office Hours memory, and structured aggregate evidence claims together.",
    "- Evidence bullets must be grounded in the claim summaries or context facts below. Do not invent customers, revenue, installs, signups, payments, PRs, or traffic.",
    "- primaryActionId must be one of the available action ids.",
    "- Do not include raw rows, person IDs, emails, IP addresses, tokens, stack traces, or full query results.",
    "- Avoid the visible English word 'activation'; write Korean such as '검증 행동', '활성 행동', or '첫 핵심 행동'.",
    "- Keep title under 80 Korean characters and body under 180 Korean characters.",
    "- GitHub/build volume is build/ship evidence, not customer evidence.",
    "- Work-history and adaptive-rule claims are diagnostic only and can never justify healthy.",
    "- Missing source is not zero. If a source is unavailable, call out the measurement gap instead of treating it as observed zero.",
    "- healthy is allowed only when requirements show completed customer evidence, required active-user measurement satisfied, no blocked gate, and no overdue proof debt.",
    "",
    `Allowed states: ${toArray(context.allowedStates).join(", ")}`,
    `Available action ids: ${toArray(context.availableActionIds).join(", ")}`,
    `Context refs: ${toArray(context.contextRefs).join(", ")}`,
    `Evidence requirements: ${renderRequirements(context.evidenceBundle?.requirements || {})}`,
    "",
    "## Onboarding",
    renderLines("answers", context.onboarding?.answers, 8),
    renderLines("context", context.onboarding?.onboardingContext, 10),
    "",
    "## Day 1 Goal",
    renderLines("goal fields", context.day1Goal?.lines, 10),
    "",
    "## Office Hours",
    renderLines("recent Q&A", context.officeHours?.recentTurns, 6),
    renderLines("open commitments", context.officeHours?.openCommitments, 6),
    renderLines("met evidence", context.officeHours?.metCommitments, 6),
    renderLines("day rollup", context.officeHours?.dayRollup, 6),
    context.officeHours?.compiledTruth ? `compiled truth: ${context.officeHours.compiledTruth}` : "",
    renderLines("open threads", context.officeHours?.openThreads, 5),
    renderLines("abandoned threads", context.officeHours?.abandonedThreads, 5),
    context.officeHours?.pendingPrediction ? `pending prediction: ${context.officeHours.pendingPrediction}` : "",
    context.officeHours?.consecutiveDeferrals ? `consecutive deferrals: ${context.officeHours.consecutiveDeferrals}` : "",
    "",
    "## Structured Evidence Claims (aggregate only)",
    ...toArray(context.evidenceBundle?.claims).map(renderClaim),
    "",
    "## Evidence Funnel",
    renderLines("funnel", context.evidenceFunnel, 8),
  ].filter((line) => line !== "").join("\n");
  return prompt.slice(0, MAX_PROMPT_CHARS);
}

function extractJsonObjectText(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.startsWith("{") && text.endsWith("}")) return text;
  const start = text.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

function parseVerdictJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  const jsonText = extractJsonObjectText(value);
  if (!jsonText) {
    throw new MorningBriefingVerdictError("invalid_json", "Morning briefing verdict provider returned no JSON object.");
  }
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new MorningBriefingVerdictError("invalid_json", `Morning briefing verdict JSON parse failed: ${error.message}`);
  }
}

function tokenize(value = "") {
  return Array.from(String(value || "").matchAll(/[가-힣A-Za-z_#.-]{2,}|\d+(?:[.,]\d+)?/g))
    .map((match) => match[0].toLowerCase())
    .filter((token) => !GROUNDING_STOPWORDS.has(token))
    .filter((token) => !/^\d{4}-\d{2}/.test(token));
}

function hasGroundingOverlap(line, phrase) {
  const lineTokens = new Set(tokenize(line));
  const phraseTokens = new Set(tokenize(phrase));
  if (!lineTokens.size || !phraseTokens.size) return false;
  const overlap = [...lineTokens].filter((token) => phraseTokens.has(token));
  const numericOverlap = overlap.some((token) => /^\d+(?:[.,]\d+)?$/.test(token));
  if (numericOverlap && overlap.length >= 2) return true;
  return overlap.length >= 3;
}

function evidenceBulletIsGrounded(line, context) {
  const text = safeText(line, 240).toLowerCase();
  if (!text) return false;
  const phrases = toArray(context?.groundingPhrases);
  return phrases.some((phrase) => {
    const safePhrase = safeText(phrase, 300).toLowerCase();
    return safePhrase.length >= 8
      && (safePhrase.includes(text) || text.includes(safePhrase) || hasGroundingOverlap(text, safePhrase));
  });
}

function validateVisibleText(field, value, max) {
  const text = safeText(value, max);
  if (!text) {
    throw new MorningBriefingVerdictError("invalid_output", `Morning briefing verdict requires ${field}.`);
  }
  if (hasUnsafeRawIdentifier(value)) {
    throw new MorningBriefingVerdictError("unsafe_output", `Morning briefing verdict ${field} contains raw identifiers.`);
  }
  if (/activation/i.test(text)) {
    throw new MorningBriefingVerdictError("unsafe_output", `Morning briefing verdict ${field} must not use visible activation wording.`);
  }
  if (/[\r\n]/.test(String(value ?? ""))) {
    throw new MorningBriefingVerdictError("invalid_output", `Morning briefing verdict ${field} must be single-line.`);
  }
  return text;
}

function validateHealthyVerdictAllowed(context = {}) {
  const requirements = context?.evidenceBundle?.requirements || {};
  const failures = [];
  if (requirements.hasCompletedCustomerEvidence !== true) {
    failures.push("completed_customer_evidence_missing");
  }
  if (requirements.activeUsersRequired === true && requirements.activeUsersSatisfied !== true) {
    failures.push("active_users_unsatisfied");
  }
  if (requirements.gateBlocked === true) {
    failures.push("gate_blocked");
  }
  const overdueProofDebtCount = finiteNumber(requirements.overdueProofDebtCount) ?? 0;
  if (overdueProofDebtCount > 0) {
    failures.push("overdue_proof_debt");
  }
  if (failures.length) {
    throw new MorningBriefingVerdictError(
      "invalid_healthy",
      `Morning briefing verdict cannot be healthy: ${failures.join(", ")}`,
      { reasons: failures },
    );
  }
}

export function normalizeMorningBriefingLlmVerdict(raw, {
  context,
  provider = "",
  generatedAt = new Date().toISOString(),
} = {}) {
  const parsed = parseVerdictJson(raw);
  const state = cleanString(parsed.state, 80);
  if (!MORNING_BRIEFING_VERDICT_STATES.includes(state)) {
    throw new MorningBriefingVerdictError("invalid_state", `Unsupported morning briefing verdict state: ${state || "(empty)"}`);
  }
  const primaryActionId = cleanString(parsed.primaryActionId, 80);
  if (!toArray(context?.availableActionIds).includes(primaryActionId)) {
    throw new MorningBriefingVerdictError("invalid_action", `Unsupported morning briefing verdict action id: ${primaryActionId || "(empty)"}`);
  }
  if (state === "healthy") {
    validateHealthyVerdictAllowed(context);
  }
  const title = validateVisibleText("title", parsed.title, 100);
  const body = validateVisibleText("body", parsed.body, 240);
  const evidence = toArray(parsed.evidence)
    .map((line) => validateVisibleText("evidence", line, 200))
    .filter(Boolean);
  if (evidence.length < 2 || evidence.length > 4) {
    throw new MorningBriefingVerdictError("invalid_evidence", "Morning briefing verdict evidence must contain 2-4 bullets.");
  }
  const ungrounded = evidence.find((line) => !evidenceBulletIsGrounded(line, context));
  if (ungrounded) {
    throw new MorningBriefingVerdictError("ungrounded_evidence", `Morning briefing verdict evidence is not grounded: ${ungrounded}`);
  }
  const verdictProvider = cleanString(provider, 40);
  if (!verdictProvider) {
    throw new MorningBriefingVerdictError("missing_provider", "Morning briefing verdict requires provider metadata.");
  }
  return {
    state,
    title,
    body,
    evidence,
    primaryActionId,
    verdictProvider,
    verdictGeneratedAt: cleanString(generatedAt, 80),
    contextRefs: toArray(context?.contextRefs).map((ref) => safeText(ref, 80)).filter(Boolean),
  };
}

function hasCompleteMorningBriefingVerdict(briefing) {
  const verdict = briefing?.customerEvidenceVerdict;
  if (!verdict || typeof verdict !== "object" || Array.isArray(verdict)) return false;
  if (!MORNING_BRIEFING_VERDICT_STATES.includes(cleanString(verdict.state, 80))) return false;
  if (!cleanString(verdict.title, 100) || !cleanString(verdict.body, 240)) return false;
  const evidence = toArray(verdict.evidence).map((line) => cleanString(line, 200)).filter(Boolean);
  if (evidence.length < 2 || evidence.length > 4) return false;
  if (!cleanString(verdict.primaryActionId, 80)) return false;
  if (!cleanString(verdict.verdictProvider, 40) || !cleanString(verdict.verdictGeneratedAt, 80)) return false;
  const refs = new Set(toArray(verdict.contextRefs).map((ref) => cleanString(ref, 80)));
  return ["onboarding", "day1_goal", "office_hours", ...REQUIRED_SOURCE_REFS]
    .every((ref) => refs.has(ref));
}

export function isMorningBriefingLlmVerdict(briefing) {
  if (!hasCompleteMorningBriefingVerdict(briefing)) return false;
  return cleanString(briefing?.customerEvidenceVerdict?.verdictProvider, 40) !== "local_fallback";
}

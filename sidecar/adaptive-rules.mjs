/**
 * Adaptive rules — MVP 8종 (spec §12, §24-4 — P1-2).
 *
 * AR-01, AR-02, AR-05, AR-07, AR-08, AR-14, AR-17, AR-19. Pure evaluation
 * over a caller-assembled signal snapshot; persistence goes to the gate
 * ledger (`adaptiveEvents[]`, §15.3) via the helpers below.
 *
 * 공통 오탐 대응 (spec §12):
 * 1. every fired rule carries its source signals so the founder can dispute,
 * 2. a user "오탐(false_positive)" label imposes a 48h cooldown on that rule,
 * 3. rules keyed on external auto-collection (AR-08) never fire while the
 *    source gate reports the source unavailable (fail-closed).
 */

import {
  loadGateLedger,
  resolveGateLedgerPath,
  normalizeGateLedger,
} from "./program-gate-engine.mjs";
import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import { assembleAdaptiveRuleSignals } from "./adaptive-rule-signals.mjs";

export const ADAPTIVE_RULES_SCHEMA_VERSION = 1;
export const ADAPTIVE_RULE_FALSE_POSITIVE_LABEL = "false_positive";
export const ADAPTIVE_RULE_COOLDOWN_MS = 48 * 60 * 60 * 1000;

/** 주간 인터뷰 strong 쿼터 (spec §12 AR-02: W1–W3 3건, W4 2건). */
export const WEEKLY_INTERVIEW_QUOTA = Object.freeze({ 1: 3, 2: 3, 3: 3, 4: 2 });

export const MVP_ADAPTIVE_RULE_IDS = Object.freeze([
  "AR-01", "AR-02", "AR-05", "AR-07", "AR-08", "AR-14", "AR-17", "AR-19",
]);

/**
 * Evaluates the MVP rule set against a signal snapshot.
 *
 * signals (모두 optional — 누락은 미발동으로 처리, fail-closed):
 * - buildWithoutCustomerEvidenceDays: 연속 일수 (daily digest 파생)
 * - weekNumber, weeklyInterviewStrongCount
 * - maxActionCarryOverCount (adaptive-curriculum carryOverQueue 파생)
 * - weakOnlyEvidenceDays (proof-ledger 파생, §9.3)
 * - deployVerifiedUrlExists, cloudflareVisitsZeroDays
 * - paymentIntentCount, paymentRecordCount, paymentFailureCount
 * - abandonedThreadCount, newCommitmentsSinceAbandoned
 * - daysSinceDayProgressUpdate, appActive
 *
 * sources: { cloudflareAvailable } — 자동집계 rule 발동 게이트 (§12 ③).
 * recentAdaptiveEvents: gate-ledger adaptiveEvents (오탐 쿨다운 판정 입력).
 */
export function evaluateAdaptiveRules({
  signals = {},
  sources = {},
  recentAdaptiveEvents = [],
  now = new Date(),
} = {}) {
  const fired = [];
  const cooldown = buildCooldownIndex(recentAdaptiveEvents, now);
  const push = (rule) => {
    if (cooldown.has(rule.ruleId)) return;
    fired.push(rule);
  };

  const bwceDays = nonNegativeInt(signals.buildWithoutCustomerEvidenceDays);
  if (bwceDays !== null && bwceDays >= 2) {
    push({
      ruleId: "AR-01",
      confidence: "high",
      userMessage: `${bwceDays}일째 커밋만 있고 고객 신호가 0이다.`,
      nextAction: "오늘 미션을 고객 접촉으로 강제 치환",
      progression: "allow_with_warning",
      ohEscalation: bwceDays >= 3 ? "immediate" : "none",
      signals: { buildWithoutCustomerEvidenceDays: bwceDays },
    });
  }

  const week = nonNegativeInt(signals.weekNumber);
  const interviews = nonNegativeInt(signals.weeklyInterviewStrongCount);
  if (week !== null && interviews !== null) {
    const quota = WEEKLY_INTERVIEW_QUOTA[Math.min(Math.max(week, 1), 4)] ?? 3;
    if (interviews < quota) {
      push({
        ruleId: "AR-02",
        confidence: "high",
        userMessage: `이번 주 인터뷰 쿼터 미달 (${interviews}/${quota}).`,
        nextAction: "BIP radar 후보 3명 제시 + DM 초안",
        progression: "allow",
        ohEscalation: interviews < quota * 0.5 ? "scheduled" : "none",
        signals: { weekNumber: week, weeklyInterviewStrongCount: interviews, quota },
      });
    }
  }

  const carryOver = nonNegativeInt(signals.maxActionCarryOverCount);
  if (carryOver !== null && carryOver >= 3) {
    push({
      ruleId: "AR-05",
      confidence: "high",
      userMessage: `같은 행동이 ${carryOver}일째 막혀 있다.`,
      nextAction: "mission을 더 작은 단위로 분해 제안",
      progression: "allow",
      ohEscalation: "none",
      signals: { maxActionCarryOverCount: carryOver },
    });
  }

  const weakDays = nonNegativeInt(signals.weakOnlyEvidenceDays);
  if (weakDays !== null && weakDays >= 2) {
    push({
      ruleId: "AR-07",
      confidence: "high",
      userMessage: `${weakDays}일 연속 검증 가능한 증거가 없다.`,
      nextAction: "증거 종류 가이드 + 재제출",
      progression: "block_if_milestone",
      ohEscalation: "immediate_candidate",
      signals: { weakOnlyEvidenceDays: weakDays },
    });
  }

  // AR-08 keys on Cloudflare auto-collection — never fires while the source
  // is unavailable (§12 오탐대응 ③, fail-closed).
  const visitsZeroDays = nonNegativeInt(signals.cloudflareVisitsZeroDays);
  if (
    sources.cloudflareAvailable === true
    && signals.deployVerifiedUrlExists === true
    && visitsZeroDays !== null
    && visitsZeroDays >= 3
  ) {
    push({
      ruleId: "AR-08",
      confidence: "high",
      userMessage: "배포는 끝났고 유입이 0이다.",
      nextAction: "채널 1개 선택 + 첫 포스트 mission",
      progression: "allow",
      ohEscalation: "joins_G5",
      signals: { deployVerifiedUrlExists: true, cloudflareVisitsZeroDays: visitsZeroDays },
    });
  }

  const intents = nonNegativeInt(signals.paymentIntentCount);
  const records = nonNegativeInt(signals.paymentRecordCount);
  const failures = nonNegativeInt(signals.paymentFailureCount);
  if (
    (intents !== null && intents >= 2 && (records ?? 0) === 0)
    || (failures !== null && failures >= 2)
  ) {
    push({
      ruleId: "AR-14",
      confidence: "high",
      userMessage: "의향과 결제 사이가 끊겼다.",
      nextAction: "결제 경로 점검 + 가격/패키지 변형 1개",
      progression: "allow",
      ohEscalation: "immediate",
      signals: {
        paymentIntentCount: intents ?? 0,
        paymentRecordCount: records ?? 0,
        paymentFailureCount: failures ?? 0,
      },
    });
  }

  const abandoned = nonNegativeInt(signals.abandonedThreadCount);
  const newCommitments = nonNegativeInt(signals.newCommitmentsSinceAbandoned);
  if (abandoned !== null && abandoned >= 1 && newCommitments !== null && newCommitments >= 1) {
    push({
      ruleId: "AR-17",
      confidence: "high",
      userMessage: `${abandoned}건의 증거 0인 약속 위에 새 약속을 쌓고 있다.`,
      nextAction: "기존 커밋먼트 1개 닫기 전 신규 금지",
      progression: "block_new_commitments",
      ohEscalation: "immediate",
      signals: { abandonedThreadCount: abandoned, newCommitmentsSinceAbandoned: newCommitments },
    });
  }

  const stalledDays = nonNegativeInt(signals.daysSinceDayProgressUpdate);
  if (stalledDays !== null && stalledDays >= 3 && signals.appActive === true) {
    push({
      ruleId: "AR-19",
      confidence: "medium",
      userMessage: `${stalledDays}일째 멈췄다. 가장 작은 다음 행동 1개부터.`,
      nextAction: "21:00 리마인더 강화 + 1-step mission",
      progression: "allow",
      ohEscalation: stalledDays >= 5 ? "scheduled" : "none",
      signals: { daysSinceDayProgressUpdate: stalledDays, appActive: true },
    });
  }

  return {
    schemaVersion: ADAPTIVE_RULES_SCHEMA_VERSION,
    evaluatedAt: toIso(now),
    fired,
    firedRuleIds: fired.map((rule) => rule.ruleId),
  };
}

/**
 * Full evaluation cycle: assemble signals from persisted stores, evaluate
 * the MVP rules (false-positive cooldown honored), drop rules already fired
 * on the same calendar date (한 룰은 하루 한 번), and persist fresh firings
 * to the gate ledger. Returns `{ evaluation, fired, recorded }`.
 */
export async function runAdaptiveRulesCycle({
  workspaceRoot,
  day,
  now = new Date(),
  assemble = assembleAdaptiveRuleSignals,
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("runAdaptiveRulesCycle requires workspaceRoot.");
  }
  const { signals, sources } = await assemble({ workspaceRoot, day, now });
  const ledger = await loadGateLedger({ workspaceRoot });
  const evaluation = evaluateAdaptiveRules({
    signals,
    sources,
    recentAdaptiveEvents: ledger.adaptiveEvents,
    now,
  });
  const todayKey = toIso(now).slice(0, 10);
  const fired = evaluation.fired.filter((rule) =>
    !ledger.adaptiveEvents.some((event) =>
      event.ruleId === rule.ruleId && String(event.firedAt).slice(0, 10) === todayKey,
    ),
  );
  const recorded = await recordFiredAdaptiveRules({ workspaceRoot, fired, now });
  return { evaluation, fired, recorded };
}

/** Persists fired rules to gate-ledger adaptiveEvents (§15.3). */
export async function recordFiredAdaptiveRules({ workspaceRoot, fired = [], now = new Date() } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("recordFiredAdaptiveRules requires workspaceRoot.");
  }
  const candidates = (Array.isArray(fired) ? fired : [])
    .map((rule) => ({
      ruleId: String(rule?.ruleId ?? rule?.rule_id ?? "").trim(),
      firedAt: toIso(now),
      signals: rule?.signals,
      userLabel: null,
    }))
    .filter((rule) => rule.ruleId);
  if (!candidates.length) return [];

  const filePath = resolveGateLedgerPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const ledger = await loadGateLedger({ workspaceRoot });
    const recordedDayKeys = new Set(
      ledger.adaptiveEvents.map((event) =>
        `${event.ruleId}:${String(event.firedAt ?? event.fired_at ?? "").slice(0, 10)}`,
      ),
    );
    const recorded = [];
    for (const candidate of candidates) {
      const dayKey = `${candidate.ruleId}:${candidate.firedAt.slice(0, 10)}`;
      if (recordedDayKeys.has(dayKey)) continue;
      recordedDayKeys.add(dayKey);
      recorded.push(candidate);
    }
    if (!recorded.length) return [];
    const next = normalizeGateLedger({
      ...ledger,
      updatedAt: toIso(now),
      adaptiveEvents: [...ledger.adaptiveEvents, ...recorded],
    });
    await atomicWriteJson(filePath, next);
    return next.adaptiveEvents.slice(-recorded.length);
  });
}

/**
 * AR-17 진행 효과 (§12 표: 신규 커밋먼트 차단): true when any AR-17
 * firing is still undisputed. The founder's false-positive label lifts the
 * block; an armed intervention commit is exempted by the caller (§13.4 token
 * path stays open).
 */
export async function isNewCommitmentBlockedByAr17({ workspaceRoot } = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") return false;
  const ledger = await loadGateLedger({ workspaceRoot });
  return ledger.adaptiveEvents.some((event) =>
    event.ruleId === "AR-17"
      && event.userLabel !== ADAPTIVE_RULE_FALSE_POSITIVE_LABEL,
  );
}

/**
 * 오탐 라벨 (§12 오탐대응 ②): marks the most recent unlabeled event for the
 * rule, which imposes the 48h cooldown on future firings. user-origin only —
 * callers must pass labels typed by the founder, never model output.
 */
export async function labelAdaptiveRuleEvent({
  workspaceRoot,
  ruleId,
  label = ADAPTIVE_RULE_FALSE_POSITIVE_LABEL,
  now = new Date(),
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("labelAdaptiveRuleEvent requires workspaceRoot.");
  }
  const filePath = resolveGateLedgerPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const ledger = await loadGateLedger({ workspaceRoot });
    const events = [...ledger.adaptiveEvents];
    let labeled = null;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].ruleId === ruleId && !events[index].userLabel) {
        const labeledAt = toIso(now);
        labeled = {
          ...events[index],
          userLabel: label,
          user_label: label,
          labeledAt,
          labeled_at: labeledAt,
        };
        events[index] = labeled;
        break;
      }
    }
    if (!labeled) return { labeled: null, ledger };
    const next = normalizeGateLedger({ ...ledger, updatedAt: toIso(now), adaptiveEvents: events });
    await atomicWriteJson(filePath, next);
    return { labeled, ledger: next };
  });
}

function buildCooldownIndex(recentAdaptiveEvents = [], now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const cooled = new Set();
  for (const event of Array.isArray(recentAdaptiveEvents) ? recentAdaptiveEvents : []) {
    if (event?.userLabel !== ADAPTIVE_RULE_FALSE_POSITIVE_LABEL) continue;
    const labelTimestamp = [
      event.labelAt,
      event.label_at,
      event.labeledAt,
      event.labeled_at,
      event.firedAt,
      event.fired_at,
    ].find((value) => String(value ?? "").trim());
    const labelMs = Date.parse(String(labelTimestamp ?? ""));
    if (!Number.isFinite(labelMs)) continue;
    if (nowMs - labelMs < ADAPTIVE_RULE_COOLDOWN_MS) {
      cooled.add(String(event.ruleId ?? event.rule_id ?? ""));
    }
  }
  return cooled;
}

function nonNegativeInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.trunc(number);
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

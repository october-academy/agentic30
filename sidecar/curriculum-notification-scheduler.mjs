import { resolveCurriculumNotificationEligibility } from "./adaptive-curriculum.mjs";

export const CURRICULUM_NOTIFICATION_SCHEDULE_SCHEMA_VERSION = 1;
export const CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_IDENTIFIER =
  "agentic30.curriculum.incomplete-day-reminder";
export const CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_FIXED_TIME = "21:00";

export function buildCurriculumNotificationSchedule({
  progressState = {},
  day = null,
  currentDay = null,
  notificationConfig = null,
  now = new Date(),
} = {}) {
  const eligibility = resolveCurriculumNotificationEligibility({
    progressState,
    day,
    currentDay,
    notificationConfig,
    now,
  });

  if (eligibility.eligible !== true) {
    return {
      schema: "agentic30.curriculum.notification_schedule.v1",
      schemaVersion: CURRICULUM_NOTIFICATION_SCHEDULE_SCHEMA_VERSION,
      schema_version: CURRICULUM_NOTIFICATION_SCHEDULE_SCHEMA_VERSION,
      shouldRegister: false,
      should_register: false,
      reason: eligibility.reason,
      eligibility,
      notificationRequest: null,
      notification_request: null,
    };
  }

  const trigger = {
    type: "local_calendar_time",
    calendar: "local",
    hour: 21,
    minute: 0,
    repeats: true,
    fixedTime: CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_FIXED_TIME,
    fixed_time: CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_FIXED_TIME,
  };
  const dayId = eligibility.day;
  const request = {
    identifier: CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_IDENTIFIER,
    title: "오늘 Day 마무리",
    body: `Day ${dayId}가 아직 남아 있어요. 9시에 이어서 해보세요.`,
    sound: "default",
    trigger,
    userInfo: {
      kind: "curriculum_incomplete_day_reminder",
      day: dayId,
      day_id: dayId,
      fixedTime: CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_FIXED_TIME,
      fixed_time: CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_FIXED_TIME,
    },
    user_info: {
      kind: "curriculum_incomplete_day_reminder",
      day: dayId,
      day_id: dayId,
      fixedTime: CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_FIXED_TIME,
      fixed_time: CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_FIXED_TIME,
    },
  };

  return {
    schema: "agentic30.curriculum.notification_schedule.v1",
    schemaVersion: CURRICULUM_NOTIFICATION_SCHEDULE_SCHEMA_VERSION,
    schema_version: CURRICULUM_NOTIFICATION_SCHEDULE_SCHEMA_VERSION,
    shouldRegister: true,
    should_register: true,
    reason: "eligible_day_register_local_21_00_trigger",
    eligibility,
    notificationRequest: request,
    notification_request: request,
  };
}

// ── §19 확장: program 알림 2종 (같은 스케줄러, 일일 상한 2건 + lastSent dedup) ──

export const GATE_BLOCKED_MORNING_NOTIFICATION_IDENTIFIER =
  "agentic30.program.gate-blocked-morning";
export const COMMITMENT_DUE_NOTIFICATION_IDENTIFIER =
  "agentic30.program.commitment-due";
// §19: 아침 알림은 브리핑 시각 — 브리핑은 탭 진입 트리거라 고정 시각이 없어
// 로컬 09:00을 아침 기준으로 채택한다 (dueDay 알림과 동일, §19-2).
export const PROGRAM_NOTIFICATION_MORNING_TIME = "09:00";
export const PROGRAM_NOTIFICATION_DAILY_LIMIT = 2;

/**
 * §19-1/§19-2: gate-blocked 아침 알림 + 커밋먼트 dueDay 알림.
 * `lastSent` (`{ [identifier]: "YYYY-MM-DD" }`)가 기존 중복 방지 패턴을
 * 재사용하고, 하루 최대 2건만 반환한다. graduated/terminal 중지는 기존
 * eligibility(§19-4)가 21:00 리마인더와 함께 처리한다.
 */
export function buildProgramNotificationSchedule({
  gates = {},
  commitments = [],
  currentDay = null,
  lastSent = {},
  now = new Date(),
} = {}) {
  const todayKey = localDateKey(now);
  const notifications = [];
  const skipped = [];
  const morningTrigger = {
    type: "local_calendar_time",
    calendar: "local",
    hour: 9,
    minute: 0,
    repeats: false,
    fixedTime: PROGRAM_NOTIFICATION_MORNING_TIME,
    fixed_time: PROGRAM_NOTIFICATION_MORNING_TIME,
  };

  const blockedGate = Object.values(gates && typeof gates === "object" ? gates : {})
    .find((gate) => gate?.state === "blocked" && gate?.provisional?.active !== true);
  if (blockedGate) {
    if (lastSent?.[GATE_BLOCKED_MORNING_NOTIFICATION_IDENTIFIER] === todayKey) {
      skipped.push({ identifier: GATE_BLOCKED_MORNING_NOTIFICATION_IDENTIFIER, reason: "already_sent_today" });
    } else {
      const firstEvidence = Array.isArray(blockedGate.requiredEvidence)
        ? blockedGate.requiredEvidence[0]?.label ?? ""
        : "";
      notifications.push({
        identifier: GATE_BLOCKED_MORNING_NOTIFICATION_IDENTIFIER,
        title: `${blockedGate.gateId ?? "milestone"} 게이트가 잠겨 있어`,
        body: firstEvidence
          ? `필요한 증거 1개: ${firstEvidence}`
          : "필요한 증거를 제출하면 다음 Day가 열려.",
        sound: "default",
        trigger: morningTrigger,
        userInfo: {
          kind: "program_gate_blocked_morning",
          gateId: blockedGate.gateId ?? "",
          gate_id: blockedGate.gateId ?? "",
        },
        user_info: {
          kind: "program_gate_blocked_morning",
          gateId: blockedGate.gateId ?? "",
          gate_id: blockedGate.gateId ?? "",
        },
      });
    }
  }

  const day = Number(currentDay);
  const dueCommitment = Array.isArray(commitments)
    ? commitments.find((commitment) =>
        commitment?.status === "open"
          && Number(commitment?.dueDay ?? commitment?.due_day) === day,
      )
    : null;
  if (dueCommitment && Number.isFinite(day)) {
    if (lastSent?.[COMMITMENT_DUE_NOTIFICATION_IDENTIFIER] === todayKey) {
      skipped.push({ identifier: COMMITMENT_DUE_NOTIFICATION_IDENTIFIER, reason: "already_sent_today" });
    } else {
      const text = String(dueCommitment.text ?? "").slice(0, 80);
      notifications.push({
        identifier: COMMITMENT_DUE_NOTIFICATION_IDENTIFIER,
        title: "오늘이 기한인 약속이 있어",
        body: text || "기한이 오늘인 커밋먼트의 증거를 제출해줘.",
        sound: "default",
        trigger: morningTrigger,
        userInfo: {
          kind: "program_commitment_due",
          day,
          day_id: day,
        },
        user_info: {
          kind: "program_commitment_due",
          day,
          day_id: day,
        },
      });
    }
  }

  const capped = notifications.slice(0, PROGRAM_NOTIFICATION_DAILY_LIMIT);
  for (const dropped of notifications.slice(PROGRAM_NOTIFICATION_DAILY_LIMIT)) {
    skipped.push({ identifier: dropped.identifier, reason: "daily_limit_reached" });
  }
  return {
    schema: "agentic30.program.notification_schedule.v1",
    schemaVersion: CURRICULUM_NOTIFICATION_SCHEDULE_SCHEMA_VERSION,
    schema_version: CURRICULUM_NOTIFICATION_SCHEDULE_SCHEMA_VERSION,
    dailyLimit: PROGRAM_NOTIFICATION_DAILY_LIMIT,
    daily_limit: PROGRAM_NOTIFICATION_DAILY_LIMIT,
    notifications: capped,
    skipped,
    lastSentPatch: Object.fromEntries(capped.map((request) => [request.identifier, todayKey])),
    last_sent_patch: Object.fromEntries(capped.map((request) => [request.identifier, todayKey])),
  };
}

function localDateKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

export async function registerCurriculumNotificationSchedule({
  scheduler,
  progressState = {},
  day = null,
  currentDay = null,
  notificationConfig = null,
  now = new Date(),
} = {}) {
  const schedule = buildCurriculumNotificationSchedule({
    progressState,
    day,
    currentDay,
    notificationConfig,
    now,
  });
  if (schedule.shouldRegister !== true) {
    return {
      ...schedule,
      didRegister: false,
      did_register: false,
    };
  }
  if (!scheduler || typeof scheduler.registerLocalNotification !== "function") {
    throw new TypeError("scheduler.registerLocalNotification is required");
  }

  await scheduler.registerLocalNotification(schedule.notificationRequest);
  return {
    ...schedule,
    didRegister: true,
    did_register: true,
  };
}

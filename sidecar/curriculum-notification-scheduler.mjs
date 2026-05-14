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

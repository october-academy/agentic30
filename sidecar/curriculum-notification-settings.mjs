import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";

export const CURRICULUM_NOTIFICATION_SETTINGS_SCHEMA_VERSION = 1;
export const CURRICULUM_NOTIFICATION_SETTINGS_FILENAME =
  "curriculum-notification-settings.json";
export const CURRICULUM_INCOMPLETE_DAY_REMINDER_FIXED_TIME = "21:00";

export function resolveCurriculumNotificationSettingsPath(workspaceRoot) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new TypeError("workspaceRoot is required");
  }
  return path.join(
    path.resolve(workspaceRoot),
    ".agentic30",
    CURRICULUM_NOTIFICATION_SETTINGS_FILENAME,
  );
}

export function makeDefaultCurriculumNotificationSettings(now = new Date()) {
  const updatedAt = toIso(now);
  return {
    schema: "agentic30.curriculum.notification_settings.v1",
    schemaVersion: CURRICULUM_NOTIFICATION_SETTINGS_SCHEMA_VERSION,
    schema_version: CURRICULUM_NOTIFICATION_SETTINGS_SCHEMA_VERSION,
    enabled: true,
    dailyIncompleteDayRemindersEnabled: true,
    daily_incomplete_day_reminders_enabled: true,
    fixedTime: CURRICULUM_INCOMPLETE_DAY_REMINDER_FIXED_TIME,
    fixed_time: CURRICULUM_INCOMPLETE_DAY_REMINDER_FIXED_TIME,
    disabledAt: "",
    disabled_at: "",
    updatedAt,
    updated_at: updatedAt,
  };
}

export function normalizeCurriculumNotificationSettings(value, { now = new Date() } = {}) {
  const fallback = makeDefaultCurriculumNotificationSettings(now);
  const raw = isPlainObject(value) ? value : {};
  const reminderEnabled = raw.dailyIncompleteDayRemindersEnabled
    ?? raw.daily_incomplete_day_reminders_enabled
    ?? raw.enabled
    ?? true;
  const enabled = reminderEnabled !== false;
  const disabledAt = enabled
    ? ""
    : stringOrDefault(raw.disabledAt ?? raw.disabled_at, fallback.updatedAt);
  const updatedAt = stringOrDefault(raw.updatedAt ?? raw.updated_at, fallback.updatedAt);
  return {
    ...raw,
    schema: fallback.schema,
    schemaVersion: CURRICULUM_NOTIFICATION_SETTINGS_SCHEMA_VERSION,
    schema_version: CURRICULUM_NOTIFICATION_SETTINGS_SCHEMA_VERSION,
    enabled,
    dailyIncompleteDayRemindersEnabled: enabled,
    daily_incomplete_day_reminders_enabled: enabled,
    fixedTime: stringOrDefault(
      raw.fixedTime ?? raw.fixed_time,
      CURRICULUM_INCOMPLETE_DAY_REMINDER_FIXED_TIME,
    ),
    fixed_time: stringOrDefault(
      raw.fixedTime ?? raw.fixed_time,
      CURRICULUM_INCOMPLETE_DAY_REMINDER_FIXED_TIME,
    ),
    disabledAt,
    disabled_at: disabledAt,
    updatedAt,
    updated_at: updatedAt,
  };
}

export async function loadCurriculumNotificationSettings({
  workspaceRoot = "",
  filePath = "",
  now = new Date(),
} = {}) {
  const resolvedPath = filePath || resolveCurriculumNotificationSettingsPath(workspaceRoot);
  try {
    const raw = await fs.readFile(resolvedPath, "utf8");
    return normalizeCurriculumNotificationSettings(JSON.parse(raw), { now });
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
      throw error;
    }
    return makeDefaultCurriculumNotificationSettings(now);
  }
}

export async function persistCurriculumNotificationSettings({
  workspaceRoot = "",
  filePath = "",
  settings = {},
  now = new Date(),
} = {}) {
  const resolvedPath = filePath || resolveCurriculumNotificationSettingsPath(workspaceRoot);
  const payload = normalizeCurriculumNotificationSettings(
    {
      ...settings,
      updatedAt: toIso(now),
    },
    { now },
  );
  await withFileLock(resolvedPath, async () => {
    await atomicWriteJson(resolvedPath, payload);
  });
  return payload;
}

export async function setDailyIncompleteDayReminderEnabled({
  workspaceRoot = "",
  filePath = "",
  enabled = true,
  now = new Date(),
} = {}) {
  const resolvedPath = filePath || resolveCurriculumNotificationSettingsPath(workspaceRoot);
  const previous = await loadCurriculumNotificationSettings({
    filePath: resolvedPath,
    now,
  });
  return persistCurriculumNotificationSettings({
    filePath: resolvedPath,
    settings: {
      ...previous,
      enabled: enabled !== false,
      dailyIncompleteDayRemindersEnabled: enabled !== false,
      disabledAt: enabled === false ? toIso(now) : "",
    },
    now,
  });
}

export function toCurriculumNotificationConfig(settings = {}) {
  const normalized = normalizeCurriculumNotificationSettings(settings);
  return {
    enabled: normalized.enabled,
    fixedTime: normalized.fixedTime,
    fixed_time: normalized.fixedTime,
    lastSent: stringOrDefault(settings.lastSent ?? settings.last_sent, ""),
    last_sent: stringOrDefault(settings.lastSent ?? settings.last_sent, ""),
    permanentlyStopped: false,
    permanently_stopped: false,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && Array.isArray(value) !== true;
}

function stringOrDefault(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

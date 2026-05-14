import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CURRICULUM_INCOMPLETE_DAY_REMINDER_FIXED_TIME,
  CURRICULUM_NOTIFICATION_SETTINGS_FILENAME,
  loadCurriculumNotificationSettings,
  resolveCurriculumNotificationSettingsPath,
  setDailyIncompleteDayReminderEnabled,
  toCurriculumNotificationConfig,
} from "../sidecar/curriculum-notification-settings.mjs";
import { buildCurriculumNotificationSchedule } from "../sidecar/curriculum-notification-scheduler.mjs";
import {
  CURRICULUM_DAY_TYPES,
  makeDefaultCurriculumProgressState,
} from "../sidecar/adaptive-curriculum.mjs";

async function makeWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "agentic30-notification-settings-"));
}

test("notification settings default to enabled incomplete-Day reminders", async (t) => {
  const workspaceRoot = await makeWorkspace();
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));

  const settings = await loadCurriculumNotificationSettings({
    workspaceRoot,
    now: new Date("2026-05-14T12:00:00.000Z"),
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.dailyIncompleteDayRemindersEnabled, true);
  assert.equal(settings.daily_incomplete_day_reminders_enabled, true);
  assert.equal(settings.fixedTime, CURRICULUM_INCOMPLETE_DAY_REMINDER_FIXED_TIME);
  assert.equal(settings.updatedAt, "2026-05-14T12:00:00.000Z");

  const notificationConfig = toCurriculumNotificationConfig(settings);
  assert.equal(notificationConfig.enabled, true);
  assert.equal(notificationConfig.fixedTime, "21:00");
});

test("disabled daily incomplete-Day reminder setting is persisted and read back", async (t) => {
  const workspaceRoot = await makeWorkspace();
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const settingsPath = resolveCurriculumNotificationSettingsPath(workspaceRoot);

  const saved = await setDailyIncompleteDayReminderEnabled({
    workspaceRoot,
    enabled: false,
    now: new Date("2026-05-14T13:30:00.000Z"),
  });
  const loaded = await loadCurriculumNotificationSettings({
    workspaceRoot,
    now: new Date("2026-05-14T13:31:00.000Z"),
  });
  const onDisk = JSON.parse(await fs.readFile(settingsPath, "utf8"));

  assert.equal(path.basename(settingsPath), CURRICULUM_NOTIFICATION_SETTINGS_FILENAME);
  assert.equal(saved.enabled, false);
  assert.equal(saved.dailyIncompleteDayRemindersEnabled, false);
  assert.equal(saved.disabledAt, "2026-05-14T13:30:00.000Z");
  assert.equal(loaded.enabled, false);
  assert.equal(loaded.dailyIncompleteDayRemindersEnabled, false);
  assert.equal(loaded.daily_incomplete_day_reminders_enabled, false);
  assert.equal(loaded.disabledAt, "2026-05-14T13:30:00.000Z");
  assert.equal(onDisk.enabled, false);
  assert.equal(onDisk.daily_incomplete_day_reminders_enabled, false);

  const notificationConfig = toCurriculumNotificationConfig(loaded);
  assert.equal(notificationConfig.enabled, false);
  assert.equal(notificationConfig.fixedTime, "21:00");

  const progressState = {
    ...makeDefaultCurriculumProgressState(new Date("2026-05-14T13:00:00.000Z")),
    currentDay: 5,
    dayRecords: [
      {
        day: 5,
        dayType: CURRICULUM_DAY_TYPES.action,
        completionConfirmed: false,
      },
    ],
  };
  const schedule = buildCurriculumNotificationSchedule({
    progressState,
    notificationConfig,
    now: new Date("2026-05-14T13:31:00.000Z"),
  });
  assert.equal(schedule.shouldRegister, false);
  assert.equal(schedule.reason, "notifications_disabled");
});

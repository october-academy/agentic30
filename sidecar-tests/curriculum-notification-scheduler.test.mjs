import test from "node:test";
import assert from "node:assert/strict";

import * as curriculumNotificationScheduler from "../sidecar/curriculum-notification-scheduler.mjs";
import {
  COMMITMENT_DUE_NOTIFICATION_IDENTIFIER,
  GATE_BLOCKED_MORNING_NOTIFICATION_IDENTIFIER,
  PROGRAM_NOTIFICATION_DAILY_LIMIT,
  buildProgramNotificationSchedule,
} from "../sidecar/curriculum-notification-scheduler.mjs";
import {
  CURRICULUM_DAY_TYPES,
  makeDefaultCurriculumProgressState,
} from "../sidecar/adaptive-curriculum.mjs";

test("legacy curriculum notification schedule remains available by default", () => {
  assert.equal(typeof curriculumNotificationScheduler.buildCurriculumNotificationSchedule, "function");
  const progressState = {
    ...makeDefaultCurriculumProgressState(new Date("2026-06-20T08:00:00.000Z")),
    currentDay: 5,
    dayRecords: [
      {
        day: 5,
        dayType: CURRICULUM_DAY_TYPES.action,
        completionConfirmed: false,
      },
    ],
  };

  const schedule = curriculumNotificationScheduler.buildCurriculumNotificationSchedule({
    progressState,
    currentDay: 5,
    notificationConfig: { enabled: true, fixedTime: "21:00" },
    now: new Date("2026-06-20T08:00:00.000Z"),
  });

  assert.equal(schedule.schema, "agentic30.curriculum.notification_schedule.v1");
  assert.equal(schedule.shouldRegister, true);
  assert.equal(schedule.notificationRequest.identifier, "agentic30.curriculum.incomplete-day-reminder");
});

test("program notifications build gate-blocked morning and commitment dueDay requests", () => {
  const now = new Date(2026, 5, 12, 8, 0, 0);
  const gates = {
    G4: {
      gateId: "G4",
      state: "blocked",
      provisional: null,
      requiredEvidence: [{ id: "paid_ask_strong_evidence", label: "유료 ask 발송 증거 >=1 (paymentIntent, strong)" }],
    },
  };
  const commitments = [
    { status: "open", dueDay: 15, text: "조은성에게 결제 요청 보내기" },
  ];

  const schedule = buildProgramNotificationSchedule({
    gates,
    commitments,
    currentDay: 15,
    lastSent: {},
    now,
  });

  assert.equal(schedule.schema, "agentic30.program.notification_schedule.v1");
  assert.equal(schedule.notifications.length, 2);
  assert.equal(schedule.dailyLimit, PROGRAM_NOTIFICATION_DAILY_LIMIT);
  const [gateNotice, dueNotice] = schedule.notifications;
  assert.equal(gateNotice.identifier, GATE_BLOCKED_MORNING_NOTIFICATION_IDENTIFIER);
  assert.match(gateNotice.title, /G4/);
  assert.match(gateNotice.body, /유료 ask 발송 증거/);
  assert.equal(gateNotice.trigger.calendar, "local");
  assert.equal(gateNotice.trigger.hour, 9);
  assert.equal(gateNotice.trigger.minute, 0);
  assert.equal(gateNotice.trigger.repeats, false);
  assert.equal(gateNotice.userInfo.day, 15);
  assert.equal(dueNotice.identifier, COMMITMENT_DUE_NOTIFICATION_IDENTIFIER);
  assert.match(dueNotice.body, /조은성에게 결제 요청 보내기/);
  assert.equal(schedule.lastSentPatch[GATE_BLOCKED_MORNING_NOTIFICATION_IDENTIFIER], "2026-06-12");

  const deduped = buildProgramNotificationSchedule({
    gates,
    commitments,
    currentDay: 15,
    lastSent: schedule.lastSentPatch,
    now,
  });
  assert.equal(deduped.notifications.length, 0);
  assert.equal(deduped.skipped.length, 2);
  assert.ok(deduped.skipped.every((entry) => entry.reason === "already_sent_today"));
});

test("program notifications respect provisional gates and non-due commitments", () => {
  const now = new Date(2026, 5, 12, 8, 0, 0);
  const schedule = buildProgramNotificationSchedule({
    gates: { G4: { gateId: "G4", state: "blocked", provisional: { active: true }, requiredEvidence: [] } },
    commitments: [{ status: "open", dueDay: 16, text: "내일 기한" }],
    currentDay: 15,
    lastSent: {},
    now,
  });

  assert.equal(schedule.notifications.length, 0);
  assert.equal(schedule.skipped.length, 0);
});

test("program notifications do not roll 09:00 triggers to tomorrow after the morning window", () => {
  const now = new Date(2026, 5, 12, 9, 0, 0);
  const schedule = buildProgramNotificationSchedule({
    gates: {
      G4: {
        gateId: "G4",
        state: "blocked",
        requiredEvidence: [{ label: "유료 ask 발송 증거" }],
      },
    },
    commitments: [{ status: "open", dueDay: 15, text: "오늘 기한" }],
    currentDay: 15,
    lastSent: {},
    now,
  });

  assert.equal(schedule.notifications.length, 0);
  assert.deepEqual(
    schedule.skipped.map((entry) => [entry.identifier, entry.reason]),
    [
      [GATE_BLOCKED_MORNING_NOTIFICATION_IDENTIFIER, "notification_time_elapsed"],
      [COMMITMENT_DUE_NOTIFICATION_IDENTIFIER, "notification_time_elapsed"],
    ],
  );
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_FIXED_TIME,
  CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_IDENTIFIER,
  buildCurriculumNotificationSchedule,
  registerCurriculumNotificationSchedule,
} from "../sidecar/curriculum-notification-scheduler.mjs";
import {
  CURRICULUM_DAY_TYPES,
  CURRICULUM_PROGRESS_EVENT_TYPES,
  applyCurriculumProgressEvent,
  makeDefaultCurriculumProgressState,
} from "../sidecar/adaptive-curriculum.mjs";

test("eligible incomplete Day builds a local-time 9 PM notification trigger", () => {
  const state = {
    ...makeDefaultCurriculumProgressState(new Date("2026-05-14T11:59:00.000Z")),
    currentDay: 12,
    dayRecords: [
      {
        day: 12,
        dayType: CURRICULUM_DAY_TYPES.action,
        completionConfirmed: false,
        completed: false,
      },
    ],
  };

  const schedule = buildCurriculumNotificationSchedule({
    progressState: state,
    now: new Date("2026-05-14T12:00:00.000Z"),
  });

  assert.equal(schedule.shouldRegister, true);
  assert.equal(schedule.reason, "eligible_day_register_local_21_00_trigger");
  assert.equal(schedule.notificationRequest.identifier, CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_IDENTIFIER);
  assert.equal(schedule.notificationRequest.trigger.calendar, "local");
  assert.equal(schedule.notificationRequest.trigger.hour, 21);
  assert.equal(schedule.notificationRequest.trigger.minute, 0);
  assert.equal(schedule.notificationRequest.trigger.repeats, true);
  assert.equal(schedule.notificationRequest.trigger.fixedTime, CURRICULUM_INCOMPLETE_DAY_NOTIFICATION_FIXED_TIME);
  assert.equal(schedule.notificationRequest.userInfo.day, 12);
});

test("registers only eligible Days with the injected local notification scheduler", async () => {
  const registered = [];
  const scheduler = {
    async registerLocalNotification(request) {
      registered.push(request);
    },
  };
  const state = {
    ...makeDefaultCurriculumProgressState(new Date("2026-05-14T11:59:00.000Z")),
    currentDay: 18,
    dayRecords: [
      {
        day: 18,
        dayType: CURRICULUM_DAY_TYPES.interview,
        completionConfirmed: false,
      },
    ],
  };

  const result = await registerCurriculumNotificationSchedule({
    scheduler,
    progressState: state,
    now: new Date("2026-05-14T12:00:00.000Z"),
  });

  assert.equal(result.didRegister, true);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].trigger.hour, 21);
  assert.equal(registered[0].trigger.minute, 0);
  assert.equal(registered[0].trigger.calendar, "local");
});

test("completed, disabled, future, and graduated Days do not register notifications", async () => {
  const scheduler = {
    async registerLocalNotification() {
      throw new Error("ineligible Day should not register");
    },
  };
  const incomplete = {
    ...makeDefaultCurriculumProgressState(new Date("2026-05-14T11:59:00.000Z")),
    currentDay: 7,
    dayRecords: [
      {
        day: 7,
        dayType: CURRICULUM_DAY_TYPES.review,
        completionConfirmed: false,
      },
    ],
  };
  const completed = applyCurriculumProgressEvent(incomplete, {
    type: CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
    day: 7,
    dayType: CURRICULUM_DAY_TYPES.review,
    occurredAt: "2026-05-14T12:00:00.000Z",
  });
  const disabled = {
    ...incomplete,
    notificationConfig: {
      enabled: false,
      fixedTime: "21:00",
    },
  };
  const graduated = applyCurriculumProgressEvent(
    {
      ...makeDefaultCurriculumProgressState(new Date("2026-05-14T11:59:00.000Z")),
      currentDay: 30,
    },
    {
      type: CURRICULUM_PROGRESS_EVENT_TYPES.dayCompletionConfirmed,
      day: 30,
      dayType: CURRICULUM_DAY_TYPES.action,
      occurredAt: "2026-05-14T12:00:00.000Z",
    },
  );

  for (const [progressState, reason, day] of [
    [completed, "day_already_complete", 7],
    [disabled, "notifications_disabled", 7],
    [incomplete, "day_not_unlocked", 8],
    [graduated, "curriculum_graduated", 30],
  ]) {
    const result = await registerCurriculumNotificationSchedule({
      scheduler,
      progressState,
      day,
      now: new Date("2026-05-14T12:01:00.000Z"),
    });
    assert.equal(result.didRegister, false);
    assert.equal(result.reason, reason);
    assert.equal(result.notificationRequest, null);
  }
});

// --- §19 확장: program 알림 2종 (P2) ---
test("program notifications: gate-blocked morning + commitment dueDay with dedup and daily cap", async () => {
  const { buildProgramNotificationSchedule, GATE_BLOCKED_MORNING_NOTIFICATION_IDENTIFIER, COMMITMENT_DUE_NOTIFICATION_IDENTIFIER, PROGRAM_NOTIFICATION_DAILY_LIMIT } =
    await import("../sidecar/curriculum-notification-scheduler.mjs");
  const now = new Date(2026, 5, 12, 8, 0, 0);
  const gates = {
    G4: {
      gateId: "G4",
      state: "blocked",
      provisional: null,
      requiredEvidence: [{ id: "paid_ask_strong_evidence", label: "유료 ask 발송 증거 ≥1 (paymentIntent, strong)" }],
    },
  };
  const commitments = [
    { status: "open", dueDay: 15, text: "조은성에게 결제 요청 보내기" },
  ];

  const schedule = buildProgramNotificationSchedule({ gates, commitments, currentDay: 15, lastSent: {}, now });
  assert.equal(schedule.notifications.length, 2);
  assert.equal(schedule.dailyLimit, PROGRAM_NOTIFICATION_DAILY_LIMIT);
  const [gateNotice, dueNotice] = schedule.notifications;
  assert.equal(gateNotice.identifier, GATE_BLOCKED_MORNING_NOTIFICATION_IDENTIFIER);
  assert.match(gateNotice.title, /G4/);
  assert.match(gateNotice.body, /유료 ask 발송 증거/);
  assert.equal(gateNotice.trigger.hour, 9);
  assert.equal(dueNotice.identifier, COMMITMENT_DUE_NOTIFICATION_IDENTIFIER);
  assert.match(dueNotice.body, /조은성에게 결제 요청 보내기/);
  assert.equal(schedule.lastSentPatch[GATE_BLOCKED_MORNING_NOTIFICATION_IDENTIFIER], "2026-06-12");

  // 같은 날 재실행: lastSent dedup으로 둘 다 skip.
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

test("program notifications respect provisional gates and non-due commitments", async () => {
  const { buildProgramNotificationSchedule } = await import("../sidecar/curriculum-notification-scheduler.mjs");
  const now = new Date(2026, 5, 12, 8, 0, 0);
  // Provisional-active block (§21 grace) does not nag in the morning.
  const provisional = buildProgramNotificationSchedule({
    gates: { G4: { gateId: "G4", state: "blocked", provisional: { active: true }, requiredEvidence: [] } },
    commitments: [{ status: "open", dueDay: 16, text: "내일 기한" }],
    currentDay: 15,
    lastSent: {},
    now,
  });
  assert.equal(provisional.notifications.length, 0);
});

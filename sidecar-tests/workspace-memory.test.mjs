import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { appendCurriculumAnswer } from "../sidecar/news-market-radar.mjs";
import { appendCommitment } from "../sidecar/office-hours-memory.mjs";
import {
  appendOfficeHoursTurn,
  buildOfficeHoursHistorySummary,
  clearOfficeHoursPendingQuestion,
  fingerprintOfficeHoursTurns,
  formatOfficeHoursHistoryForPrompt,
  loadDayMemory,
  loadDayRollup,
  loadOfficeHoursPendingQuestion,
  loadOfficeHoursPendingQuestions,
  loadOfficeHoursTurnLog,
  loadOnboardingMemory,
  refreshDayMemory,
  reviseOfficeHoursTurn,
  resolveDayMemoryPath,
  resolveDayRollupPath,
  resolveOfficeHoursPendingPath,
  resolveOnboardingMemoryPath,
  saveOfficeHoursPendingQuestion,
  saveOnboardingMemory,
} from "../sidecar/workspace-memory.mjs";

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "agentic30-workspace-memory-"));
}

test("onboarding memory is canonical under .agentic30/memory and redacts secret-like source fields", async () => {
  const root = await tempWorkspace();
  try {
    await saveOnboardingMemory({
      workspaceRoot: root,
      memory: {
        onboardingContext: {
          focus_area: "development",
          work_mode: "side_project",
          custom_work_mode: "하루 1~2시간",
          product_bottleneck: "first_active_users",
          isolation_levels: ["project_folder", "work_log"],
        },
        readSources: [
          {
            id: "notion",
            status: "connected",
            path: "https://notion.so/workspace",
            token: "SHOULD_NOT_PERSIST",
          },
        ],
      },
      now: new Date("2026-06-09T00:00:00.000Z"),
    });

    const memoryPath = resolveOnboardingMemoryPath(root);
    assert.ok(memoryPath.endsWith(path.join(".agentic30", "memory", "onboarding.json")));
    const raw = await fs.readFile(memoryPath, "utf8");
    assert.equal(raw.includes("SHOULD_NOT_PERSIST"), false);
    const loaded = await loadOnboardingMemory({ workspaceRoot: root });
    assert.equal(loaded.schemaVersion, 3);
    assert.equal(loaded.schema, "agentic30.memory.onboarding.v3");
    assert.equal(loaded.onboardingContext.focus_area, "development");
    assert.equal(loaded.onboardingContext.role, undefined);
    assert.equal(loaded.answers.primaryFocus.id, "primary_focus");
    assert.equal(loaded.answers.primaryFocus.answer, "development");
    assert.equal(loaded.onboardingContext.product_bottleneck, "first_active_users");
    assert.equal(loaded.onboardingContext.project_stage, undefined);
    assert.equal(loaded.answers.primaryBottleneck.id, "primary_bottleneck");
    assert.equal(loaded.answers.primaryBottleneck.answer, "first_active_users");
    assert.equal(loaded.readSources[0].id, "notion");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("onboarding memory does not promote legacy project_stage into product_bottleneck", async () => {
  const root = await tempWorkspace();
  try {
    await saveOnboardingMemory({
      workspaceRoot: root,
      memory: {
        onboardingContext: {
          focus_area: "development",
          project_stage: "building",
          isolation_levels: ["project_folder"],
        },
      },
      now: new Date("2026-06-09T00:00:00.000Z"),
    });

    const loaded = await loadOnboardingMemory({ workspaceRoot: root });
    assert.equal(loaded.onboardingContext.project_stage, undefined);
    assert.equal(loaded.onboardingContext.product_bottleneck, "");
    assert.equal(loaded.answers.primaryBottleneck.answer, "");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("onboarding memory does not promote legacy role into focus_area", async () => {
  const root = await tempWorkspace();
  try {
    await saveOnboardingMemory({
      workspaceRoot: root,
      memory: {
        onboardingContext: {
          role: "developer",
          product_bottleneck: "first_active_users",
          isolation_levels: ["project_folder"],
        },
      },
      now: new Date("2026-06-09T00:00:00.000Z"),
    });

    const loaded = await loadOnboardingMemory({ workspaceRoot: root });
    assert.equal(loaded.onboardingContext.role, undefined);
    assert.equal(loaded.onboardingContext.focus_area, "");
    assert.equal(loaded.answers.primaryFocus.answer, "");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("legacy onboarding memory schema is ignored on load", async () => {
  const root = await tempWorkspace();
  try {
    const memoryPath = resolveOnboardingMemoryPath(root);
    await fs.mkdir(path.dirname(memoryPath), { recursive: true });
    await fs.writeFile(memoryPath, JSON.stringify({
      schemaVersion: 1,
      schema: "agentic30.memory.onboarding.v1",
      onboardingContext: {
        role: "developer",
        project_stage: "building",
      },
    }));

    const loaded = await loadOnboardingMemory({ workspaceRoot: root });
    assert.equal(loaded, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("day memory persists per-day details plus cumulative rollup for Day 30 retrieval", async () => {
  const root = await tempWorkspace();
  try {
    for (let day = 1; day <= 29; day += 1) {
      await appendCurriculumAnswer({
        workspaceRoot: root,
        answer: {
          day,
          questionId: `q-${day}`,
          questionTitle: `Day ${day} 질문`,
          answerTitle: `Day ${day} 답변`,
        },
        now: new Date(`2026-06-${String(Math.min(day, 28)).padStart(2, "0")}T00:00:00.000Z`),
      });
      await refreshDayMemory({ workspaceRoot: root, day });
    }
    await appendCommitment({
      workspaceRoot: root,
      text: "Day 29 고객 DM 보내기",
      cycle: 29,
      day: 29,
      originText: "Day 29 고객 DM 보내기",
      now: new Date("2026-06-29T00:00:00.000Z"),
    });
    await appendOfficeHoursTurn({
      workspaceRoot: root,
      turn: {
        day: 29,
        questionText: "Day 29 Office Hours 질문",
        responseText: "Day 29 Office Hours 답변",
      },
      now: new Date("2026-06-29T00:01:00.000Z"),
    });
    await refreshDayMemory({ workspaceRoot: root, day: 29 });

    const day1 = await loadDayMemory({ workspaceRoot: root, day: 1 });
    const day29 = await loadDayMemory({ workspaceRoot: root, day: 29 });
    const rollup = await loadDayRollup({ workspaceRoot: root });
    const history = await buildOfficeHoursHistorySummary({ workspaceRoot: root, day: 30 });
    const prompt = formatOfficeHoursHistoryForPrompt(history);

    assert.ok(resolveDayMemoryPath(root, 1).endsWith(path.join(".agentic30", "memory", "days", "day-1.json")));
    assert.ok(resolveDayRollupPath(root).endsWith(path.join(".agentic30", "memory", "day-rollup.json")));
    assert.equal(day1.summary.latestQuestion, "Day 1 질문");
    assert.equal(day29.summary.openCommitments, 1);
    assert.equal(rollup.days.length, 29);
    assert.equal(rollup.days[28].detailPath, ".agentic30/memory/days/day-29.json");
    assert.equal(history.dayRollup.length, 29);
    assert.ok(prompt.includes("Memory map: onboarding=.agentic30/memory/onboarding.json"));
    assert.ok(prompt.includes("Day 29"));
    assert.ok(prompt.includes("detail=.agentic30/memory/days/day-29.json"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// The terminal stamp (대안 비교 closing-card answer) is what lets the
// incomplete-interview gate accept a smart-skip interview that finished with
// fewer answers than the expected count — it must survive the normalize →
// write → load round trip, and stay absent on ordinary turns.
test("office hours turn log round-trips the terminal closing-card stamp", async () => {
  const root = await tempWorkspace();
  try {
    await appendOfficeHoursTurn({
      workspaceRoot: root,
      turn: {
        day: 2,
        sessionId: "session-a",
        questionText: "오늘 그 한 통을 어떤 안으로 보낼 건가?",
        responseText: "최소안: 지금 박고 오늘 발송",
        signalId: "office_hours_alternatives",
        signalLabel: "Office Hours 대안 비교",
        terminal: true,
      },
      now: new Date("2026-06-11T00:00:00.000Z"),
    });
    await appendOfficeHoursTurn({
      workspaceRoot: root,
      turn: {
        day: 2,
        sessionId: "session-a",
        questionText: "막고 있는 건 무엇인가?",
        responseText: "금액 미정",
      },
      now: new Date("2026-06-11T00:01:00.000Z"),
    });

    const log = await loadOfficeHoursTurnLog({ workspaceRoot: root });
    assert.equal(log.turns.length, 2);
    assert.equal(log.turns[0].terminal, true);
    assert.equal(log.turns[0].signalId, "office_hours_alternatives");
    assert.equal(log.turns[0].signalLabel, "Office Hours 대안 비교");
    assert.equal("terminal" in log.turns[1], false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function makePromptSnapshot({
  requestId = "request-1",
  sessionId = "session-a",
  question = "어떤 고객에게 먼저 물어볼까요?",
} = {}) {
  return {
    requestId,
    sessionId,
    toolName: "agentic30_request_user_input",
    title: "Office Hours",
    createdAt: "2026-06-11T00:00:00.000Z",
    questions: [
      {
        questionId: "office_hours_target",
        header: "대상 사용자",
        question,
        options: [
          { label: "1인 개발자", description: "혼자 제품을 만드는 개발자" },
          { label: "B2B SaaS 팀", description: "작은 SaaS 팀" },
        ],
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        freeTextPlaceholder: "구체적인 사람을 적어주세요",
      },
    ],
    generation: {
      mode: "office_hours_structured_input",
      signalId: "office_hours_target",
      signalLabel: "대상 사용자",
      dimensionStepIndex: 1,
      dimensionTotal: 6,
    },
  };
}

test("office hours pending question memory round-trips by day and clears by request", async () => {
  const root = await tempWorkspace();
  try {
    await appendOfficeHoursTurn({
      workspaceRoot: root,
      turn: {
        day: 3,
        sessionId: "session-a",
        requestId: "answered-1",
        questionText: "첫 질문",
        responseText: "첫 답변",
      },
      now: new Date("2026-06-16T00:00:00.000Z"),
    });
    const turnLog = await loadOfficeHoursTurnLog({ workspaceRoot: root });
    const saved = await saveOfficeHoursPendingQuestion({
      workspaceRoot: root,
      day: 3,
      source: "office_hours_day_3",
      request: makePromptSnapshot({
        requestId: "pending-2",
        sessionId: "session-a",
        question: "둘째 질문?",
      }),
      turnLog,
      now: new Date("2026-06-16T00:01:00.000Z"),
    });

    const filePath = resolveOfficeHoursPendingPath(root);
    assert.ok(filePath.endsWith(path.join(".agentic30", "memory", "office-hours-pending.json")));
    assert.equal(saved.pendingByDay["3"].request.requestId, "pending-2");
    assert.equal(saved.pendingByDay["3"].answeredTurnCount, 1);
    assert.equal(saved.pendingByDay["3"].turnFingerprint, fingerprintOfficeHoursTurns(turnLog.turns, 3).fingerprint);

    const loaded = await loadOfficeHoursPendingQuestion({ workspaceRoot: root, day: 3 });
    assert.equal(loaded.source, "office_hours_day_3");
    assert.equal(loaded.request.questions[0].question, "둘째 질문?");
    assert.equal(loaded.request.sessionId, "session-a");

    await clearOfficeHoursPendingQuestion({
      workspaceRoot: root,
      day: 3,
      requestId: "other-request",
    });
    assert.notEqual(await loadOfficeHoursPendingQuestion({ workspaceRoot: root, day: 3 }), null);

    await clearOfficeHoursPendingQuestion({
      workspaceRoot: root,
      day: 3,
      requestId: "pending-2",
    });
    assert.equal(await loadOfficeHoursPendingQuestion({ workspaceRoot: root, day: 3 }), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("office hours pending memory ignores malformed entries and fingerprints stale turns", async () => {
  const root = await tempWorkspace();
  try {
    const pendingPath = resolveOfficeHoursPendingPath(root);
    await fs.mkdir(path.dirname(pendingPath), { recursive: true });
    await fs.writeFile(pendingPath, JSON.stringify({
      schemaVersion: 1,
      schema: "agentic30.memory.office_hours_pending.v1",
      pendingByDay: {
        3: {
          day: 3,
          source: "office_hours_day_3",
          request: {
            requestId: "bad",
            sessionId: "session-a",
            toolName: "agentic30_request_user_input",
            createdAt: "2026-06-16T00:00:00.000Z",
            questions: [],
          },
          answeredTurnCount: 1,
          turnFingerprint: "stale",
        },
        4: {
          day: 4,
          source: "office_hours_day_4",
          request: makePromptSnapshot({
            requestId: "pending-4",
            sessionId: "session-b",
            question: "넷째 날 질문?",
          }),
          answeredTurnCount: 0,
          turnFingerprint: fingerprintOfficeHoursTurns([], 4).fingerprint,
        },
      },
    }, null, 2), "utf8");

    const loaded = await loadOfficeHoursPendingQuestions({ workspaceRoot: root });
    assert.equal(loaded.pendingByDay["3"], undefined);
    assert.equal(loaded.pendingByDay["4"].request.requestId, "pending-4");

    const before = fingerprintOfficeHoursTurns([], 4);
    await appendOfficeHoursTurn({
      workspaceRoot: root,
      turn: {
        day: 4,
        requestId: "answered-4",
        questionText: "넷째 날 질문?",
        responseText: "답변",
      },
      now: new Date("2026-06-16T00:02:00.000Z"),
    });
    const afterLog = await loadOfficeHoursTurnLog({ workspaceRoot: root });
    const after = fingerprintOfficeHoursTurns(afterLog.turns, 4);
    assert.equal(before.count, 0);
    assert.equal(after.count, 1);
    assert.notEqual(before.fingerprint, after.fingerprint);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("office hours v2 turns persist prompt snapshots and submissions while legacy turns still load", async () => {
  const root = await tempWorkspace();
  try {
    await appendOfficeHoursTurn({
      workspaceRoot: root,
      turn: {
        day: 1,
        sessionId: "session-a",
        requestId: "request-1",
        questionText: "어떤 고객에게 먼저 물어볼까요?",
        responseText: "1인 개발자",
        promptSnapshot: makePromptSnapshot(),
        submissions: [
          {
            question: "어떤 고객에게 먼저 물어볼까요?",
            selectedOptions: ["1인 개발자"],
            freeText: "",
          },
        ],
      },
      now: new Date("2026-06-11T00:01:00.000Z"),
    });

    const filePath = path.join(root, ".agentic30", "memory", "office-hours-turns.json");
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    raw.turns.push({
      day: 1,
      sessionId: "session-a",
      requestId: "legacy-request",
      questionText: "legacy question",
      responseText: "legacy answer",
      occurredAt: "2026-06-11T00:02:00.000Z",
    });
    await fs.writeFile(filePath, JSON.stringify(raw, null, 2), "utf8");

    const log = await loadOfficeHoursTurnLog({ workspaceRoot: root });
    assert.equal(log.schemaVersion, 2);
    assert.equal(log.schema, "agentic30.memory.office_hours_turns.v2");
    assert.equal(log.turns.length, 2);
    assert.equal(log.turns[0].promptSnapshot.requestId, "request-1");
    assert.equal(log.turns[0].submissions[0].selectedOptions[0], "1인 개발자");
    assert.equal(log.turns[1].requestId, "legacy-request");
    assert.equal(log.turns[1].promptSnapshot, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("office hours revision replaces target answer and removes later turns from the same day only", async () => {
  const root = await tempWorkspace();
  try {
    await appendOfficeHoursTurn({
      workspaceRoot: root,
      turn: {
        day: 1,
        sessionId: "session-a",
        requestId: "request-1",
        questionText: "Q1",
        responseText: "A1",
        promptSnapshot: makePromptSnapshot({ requestId: "request-1", question: "Q1" }),
        submissions: [{ question: "Q1", selectedOptions: ["1인 개발자"], freeText: "" }],
      },
      now: new Date("2026-06-11T00:01:00.000Z"),
    });
    await appendOfficeHoursTurn({
      workspaceRoot: root,
      turn: {
        day: 1,
        sessionId: "session-a",
        requestId: "request-2",
        questionText: "Q2",
        responseText: "A2",
        promptSnapshot: makePromptSnapshot({ requestId: "request-2", question: "Q2" }),
        submissions: [{ question: "Q2", selectedOptions: ["B2B SaaS 팀"], freeText: "" }],
      },
      now: new Date("2026-06-11T00:02:00.000Z"),
    });
    await appendOfficeHoursTurn({
      workspaceRoot: root,
      turn: {
        day: 2,
        sessionId: "session-b",
        requestId: "request-day2",
        questionText: "Day 2 Q",
        responseText: "Day 2 A",
        promptSnapshot: makePromptSnapshot({ requestId: "request-day2", sessionId: "session-b", question: "Day 2 Q" }),
        submissions: [{ question: "Day 2 Q", selectedOptions: ["1인 개발자"], freeText: "" }],
      },
      now: new Date("2026-06-12T00:01:00.000Z"),
    });

    const revision = await reviseOfficeHoursTurn({
      workspaceRoot: root,
      requestId: "request-1",
      replacementTurn: {
        day: 1,
        sessionId: "session-a",
        requestId: "request-1",
        questionText: "Q1",
        responseText: "A1 revised",
        promptSnapshot: makePromptSnapshot({ requestId: "request-1", question: "Q1" }),
        submissions: [{ question: "Q1", selectedOptions: ["B2B SaaS 팀"], freeText: "초기 팀" }],
      },
      now: new Date("2026-06-11T00:03:00.000Z"),
    });

    const log = await loadOfficeHoursTurnLog({ workspaceRoot: root });
    assert.deepEqual(log.turns.map((turn) => turn.requestId), ["request-1", "request-day2"]);
    assert.equal(log.turns[0].responseText, "A1 revised");
    assert.equal(log.turns[0].submissions[0].freeText, "초기 팀");
    assert.equal(log.turns[0].revisedAt, "2026-06-11T00:03:00.000Z");
    assert.equal(revision.removedTurns.map((turn) => turn.requestId).join(","), "request-2");

    const day1 = await loadDayMemory({ workspaceRoot: root, day: 1 });
    const day2 = await loadDayMemory({ workspaceRoot: root, day: 2 });
    assert.equal(day1.details.officeHoursTurns.length, 1);
    assert.equal(day1.details.officeHoursTurns[0].responseText, "A1 revised");
    assert.equal(day2.details.officeHoursTurns.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("office hours revision rejects legacy turns without prompt snapshots", async () => {
  const root = await tempWorkspace();
  try {
    await appendOfficeHoursTurn({
      workspaceRoot: root,
      turn: {
        day: 1,
        sessionId: "session-a",
        requestId: "legacy-request",
        questionText: "Q1",
        responseText: "A1",
      },
      now: new Date("2026-06-11T00:01:00.000Z"),
    });

    await assert.rejects(
      () => reviseOfficeHoursTurn({
        workspaceRoot: root,
        requestId: "legacy-request",
        replacementTurn: {
          day: 1,
          sessionId: "session-a",
          requestId: "legacy-request",
          questionText: "Q1",
          responseText: "A1 revised",
          promptSnapshot: makePromptSnapshot({ requestId: "legacy-request", question: "Q1" }),
          submissions: [{ question: "Q1", selectedOptions: ["1인 개발자"], freeText: "" }],
        },
      }),
      /before editable snapshots/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

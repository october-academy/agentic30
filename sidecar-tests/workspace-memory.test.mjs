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
  formatOfficeHoursHistoryForPrompt,
  loadDayMemory,
  loadDayRollup,
  loadOfficeHoursTurnLog,
  loadOnboardingMemory,
  refreshDayMemory,
  resolveDayMemoryPath,
  resolveDayRollupPath,
  resolveOnboardingMemoryPath,
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
          role: "developer",
          work_mode: "side_project",
          custom_work_mode: "하루 1~2시간",
          project_stage: "building",
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
    assert.equal(loaded.onboardingContext.role, "developer");
    assert.equal(loaded.readSources[0].id, "notion");
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
    assert.equal("terminal" in log.turns[1], false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

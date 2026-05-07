import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENTIC30_THREE_LAYERS,
  IDD_BASE_CURRICULUM,
  adaptCurriculumDay,
  buildAdaptiveCurriculum,
  deriveCurriculumSignals,
} from "../sidecar/adaptive-curriculum.mjs";

test("IDD base curriculum covers exactly 30 days and keeps the Q2 phase shape", () => {
  assert.equal(IDD_BASE_CURRICULUM.length, 30);
  assert.deepEqual(
    IDD_BASE_CURRICULUM.map((day) => day.day),
    Array.from({ length: 30 }, (_, index) => index + 1),
  );
  assert.equal(IDD_BASE_CURRICULUM.filter((day) => day.phase === "foundation").length, 7);
  assert.equal(IDD_BASE_CURRICULUM.filter((day) => day.phase === "build").length, 10);
  assert.equal(IDD_BASE_CURRICULUM.filter((day) => day.phase === "launch").length, 7);
  assert.equal(IDD_BASE_CURRICULUM.filter((day) => day.phase === "grow").length, 6);
});

test("three-layer strategy separates Founder, Company, and Product decisions", () => {
  assert.equal(AGENTIC30_THREE_LAYERS.founder.name, "Founder");
  assert.equal(AGENTIC30_THREE_LAYERS.company.name, "October Academy");
  assert.equal(AGENTIC30_THREE_LAYERS.product.name, "Agentic30");

  const plan = buildAdaptiveCurriculum({
    selectedDay: 24,
    state: {},
    now: new Date("2026-05-07T00:00:00.000Z"),
  });

  assert.equal(plan.strategy.layers.company.subject, "교육회사");
  assert.deepEqual(plan.selectedDay.layerFocus, ["company", "product"]);
  assert.ok(plan.selectedDay.layerChecks.some((line) => /October Academy/.test(line)));
  assert.ok(plan.selectedDay.layerChecks.some((line) => /Agentic30/.test(line)));
});

test("adaptive curriculum is grounded in MAC_APP_DIRECTION north star and selected day", () => {
  const plan = buildAdaptiveCurriculum({
    selectedDay: { day: 12, title: "Static day title" },
    state: {},
    now: new Date("2026-05-07T00:00:00.000Z"),
  });

  assert.equal(plan.source, "docs/MAC_APP_DIRECTION.md");
  assert.match(plan.strategy.northStar, /IDD Engine/);
  assert.match(plan.strategy.p0, /folder watch/);
  assert.equal(plan.days.length, 30);
  assert.equal(plan.selectedDay.day, 12);
  assert.equal(plan.selectedDay.title, "Static day title");
  assert.match(plan.selectedDay.summary, /L2 입력 공백/);
  assert.deepEqual(plan.selectedDay.personalization.evidenceGaps.slice(0, 3), [
    "interview_transcript",
    "journal",
    "bip",
  ]);
});

test("deriveCurriculumSignals detects L2, BIP, journal, and revenue evidence", () => {
  const signals = deriveCurriculumSignals({
    evidence: {
      fullRead: true,
      docText: "오늘 고객 인터뷰 transcript에서 가격 질문을 받았다. 결제 가능성 있음.",
      allRows: [
        { date: "2026-05-01", posts: ["첫 BIP"], insights: "L2 고객 발화 정리" },
        { date: "2026-05-02", posts: ["둘째 BIP"], insights: "가격 ask 보냄" },
      ],
      recentRows: [
        { date: "2026-05-02", posts: ["둘째 BIP"], insights: "가격 ask 보냄" },
      ],
    },
    currentMission: { status: "completed" },
  }, {
    now: new Date("2026-05-07T00:00:00.000Z"),
  });

  assert.ok(signals.interviewCount >= 1);
  assert.equal(signals.bipRows, 2);
  assert.equal(signals.hasJournal, true);
  assert.equal(signals.hasRevenueSignal, true);
  assert.equal(signals.currentMissionCompleted, true);
  assert.ok(!signals.evidenceGaps.includes("interview_transcript"));
});

test("adaptCurriculumDay evolves missing-interview foundation days into evidence capture", () => {
  const day = adaptCurriculumDay({
    curriculumDay: {
      day: 5,
      phase: "foundation",
      title: "첫 결제 구조를 세운다",
      tasks: ["유료화할 가치 1개 선택"],
      output: "페이월 카피",
    },
    state: {
      evidence: {
        fullRead: true,
        allRows: [],
        recentRows: [],
        docText: "",
      },
    },
  });

  assert.equal(day.day, 5);
  assert.match(day.tasks[0], /L2 인터뷰 transcript/);
  assert.match(day.tasks[1], /시간\/돈\/다음 일정 ask/);
  assert.ok(day.evidenceNeeds.includes("L2 quote required before insight claims"));
  assert.ok(day.evidenceNeeds.includes("time_or_money_ask"));
  assert.match(day.nextQuestions[0], /office-hours/);
  assert.match(day.nextQuestions[1], /plan-ceo-review/);
  assert.ok(day.layerChecks.some((line) => /Founder/.test(line)));
  assert.ok(day.layerChecks.some((line) => /Product/.test(line)));
});

test("adaptCurriculumDay carries completed mission result into next tasks", () => {
  const day = adaptCurriculumDay({
    curriculumDay: { day: 20, phase: "launch", title: "Warm outreach" },
    state: {
      evidence: {
        fullRead: true,
        docText: "고객 인터뷰 transcript 있음",
        allRows: [
          { date: "2026-05-06", posts: ["진행 공개"], insights: "DM 응답은 아직 없음" },
        ],
      },
      currentMission: {
        status: "completed",
        mission: "DM 10개 발송 완료",
      },
    },
  });

  assert.equal(day.day, 20);
  assert.ok(day.tasks.some((task) => /어제 완료한 미션 결과/.test(task)));
  assert.match(day.output, /최근 배움 반영/);
});

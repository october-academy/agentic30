import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENTIC30_THREE_LAYERS,
  IDD_BASE_CURRICULUM,
  adaptCurriculumDay,
  buildAdaptiveCurriculum,
  deriveCurriculumSignals,
} from "../sidecar/adaptive-curriculum.mjs";
import { FOUNDATION_DAYS } from "../sidecar/foundation-chat.mjs";

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

test("three-layer strategy separates Builder, Program, and Product decisions", () => {
  assert.equal(AGENTIC30_THREE_LAYERS.founder.name, "Builder");
  assert.equal(AGENTIC30_THREE_LAYERS.company.name, "Program");
  assert.equal(AGENTIC30_THREE_LAYERS.product.name, "Agentic30");

  const plan = buildAdaptiveCurriculum({
    selectedDay: 24,
    state: {},
    now: new Date("2026-05-07T00:00:00.000Z"),
  });

  assert.equal(plan.strategy.layers.company.subject, "반복 가능한 교육/코칭 시스템");
  assert.deepEqual(plan.selectedDay.layerFocus, ["company", "product"]);
  assert.ok(plan.selectedDay.layerChecks.some((line) => /Program/.test(line)));
  assert.ok(plan.selectedDay.layerChecks.some((line) => /Agentic30/.test(line)));
});

test("adaptive Foundation days mirror Foundation chat day semantics", () => {
  const foundationDays = IDD_BASE_CURRICULUM.filter((day) => day.phase === "foundation");

  assert.deepEqual(foundationDays.map((day) => day.day), [1, 2, 3, 4, 5, 6, 7]);
  assert.match(foundationDays[0].title, /고객의 어제 행동/);
  assert.match(FOUNDATION_DAYS[1].core_question, /압축된 통증/);
  assert.match(foundationDays[1].title, /돈이 흐르는 기준 시장/);
  assert.match(FOUNDATION_DAYS[2].core_question, /시장·고객 데이터/);
  assert.match(foundationDays[2].title, /Mom Test/);
  assert.equal(FOUNDATION_DAYS[3].sub_workflow, "office-hours-docs");
  assert.match(foundationDays[3].title, /약한 섹션/);
  assert.match(FOUNDATION_DAYS[4].core_question, /섹션을 다시 쓸/);
  assert.match(foundationDays[4].title, /수요 시그널/);
  assert.equal(FOUNDATION_DAYS[5].sub_workflow, "analyze-ads");
  assert.match(foundationDays[5].title, /돈\/시간 ask/);
  assert.equal(FOUNDATION_DAYS[6].sub_workflow, "monetization-ask");
  assert.match(foundationDays[6].title, /Go\/No-Go/);
  assert.equal(FOUNDATION_DAYS[7].sub_workflow, "foundation-summary");
});

test("base curriculum carries cross-platform app monetization lessons", () => {
  const day2 = IDD_BASE_CURRICULUM.find((day) => day.day === 2);
  const day13 = IDD_BASE_CURRICULUM.find((day) => day.day === 13);
  const day15 = IDD_BASE_CURRICULUM.find((day) => day.day === 15);
  const day16 = IDD_BASE_CURRICULUM.find((day) => day.day === 16);
  const day23 = IDD_BASE_CURRICULUM.find((day) => day.day === 23);
  const day28 = IDD_BASE_CURRICULUM.find((day) => day.day === 28);

  assert.match(day2.summary, /iOS\/Android\/Web\/Mac/);
  assert.ok(day2.tasks.some((task) => /ASO|광고 앱/.test(task)));
  assert.match(day13.summary, /iOS\/Android\/Web\/Mac/);
  assert.match(day15.title, /수익모델/);
  assert.ok(day15.tasks.some((task) => /광고\/구독\/일회성 결제/.test(task)));
  assert.ok(day16.tasks.some((task) => /App Store\/Google Play\/Web\/Mac/.test(task)));
  assert.ok(day23.tasks.some((task) => /store conversion/.test(task)));
  assert.ok(day28.tasks.some((task) => /App Store\/Google Play/.test(task)));
});

test("adaptive curriculum is grounded in direction doc north star and selected day", () => {
  const plan = buildAdaptiveCurriculum({
    selectedDay: { day: 12, title: "Static day title" },
    state: {},
    now: new Date("2026-05-07T00:00:00.000Z"),
  });

  assert.equal(plan.source, "docs/AGENTIC30-DIRECTION.md");
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
  assert.ok(day.layerChecks.some((line) => /Builder/.test(line)));
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

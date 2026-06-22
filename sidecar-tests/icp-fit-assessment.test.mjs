import test from "node:test";
import assert from "node:assert/strict";
import {
  ICP_FIT_CONDITIONS,
  assessIcpFitConditions,
  buildIcpFitDiagnosisLines,
  buildNamedCustomerNextAction,
  detectCustomerAvoidance,
} from "../sidecar/icp-fit-assessment.mjs";

test("ICP_FIT_CONDITIONS pins the five docs/ICP.md required conditions", () => {
  assert.deepEqual(
    ICP_FIT_CONDITIONS.map((c) => c.key),
    ["full_time_solo", "pre_revenue", "macos", "agent_coding_tool", "records_intent"],
  );
  // macOS is structural — Agentic30 only runs on macOS, so it is always confirmed.
  assert.equal(ICP_FIT_CONDITIONS.find((c) => c.key === "macos").structural, true);
});

test("a canonical ICP founder prompt confirms all conditions item-by-item", () => {
  const a = assessIcpFitConditions({
    prompt: "나는 퇴사한 전업 1인 개발자이고 수익은 0원, macOS에서 Codex를 쓴다. 매일 인터뷰 기록을 남길게요.",
    hypothesis: {},
    hasProjectPath: true,
  });
  assert.equal(a.allConfirmed, true);
  assert.equal(a.confirmedCount, 5);
  assert.deepEqual(a.unconfirmed, []);
  // The checklist must enumerate every condition (the judge's "항목별 대조" complaint).
  assert.equal(a.checklistLines.length, 5);
  assert.ok(a.checklist.includes("전업 1인 개발자"));
});

test("a vague prompt leaves founder conditions unconfirmed but still confirms structural macOS", () => {
  const a = assessIcpFitConditions({ prompt: "오늘 뭐부터 할까요?", hypothesis: {}, hasProjectPath: false });
  const macos = a.conditions.find((c) => c.key === "macos");
  assert.equal(macos.status, "confirmed");
  // full_time_solo / pre_revenue / agent_coding_tool / records_intent unconfirmed.
  assert.ok(a.unconfirmed.includes("전업 1인 개발자"));
  assert.ok(a.unconfirmed.includes("첫 매출 전(수익 0)"));
  assert.equal(a.allConfirmed, false);
});

test("a selected project path confirms the records/path condition without prompt text", () => {
  const withPath = assessIcpFitConditions({ prompt: "시작", hypothesis: {}, hasProjectPath: true });
  const withoutPath = assessIcpFitConditions({ prompt: "시작", hypothesis: {}, hasProjectPath: false });
  assert.equal(withPath.conditions.find((c) => c.key === "records_intent").status, "confirmed");
  assert.equal(withoutPath.conditions.find((c) => c.key === "records_intent").status, "unconfirmed");
});

test("ICP.md body in contextText does NOT falsely confirm founder conditions", () => {
  // contextText carries ICP.md itself; matching against it would always pass. The
  // assessment must only read the founder's own prompt/hypothesis.
  const icpBody = "전업 1인 개발자. 첫 매출 전. macOS. Codex. 30일 기록.";
  const a = assessIcpFitConditions({ prompt: "안녕", hypothesis: {}, contextText: icpBody, hasProjectPath: false });
  assert.ok(a.unconfirmed.includes("전업 1인 개발자"));
  assert.ok(a.unconfirmed.includes("첫 매출 전(수익 0)"));
});

test("namedCustomerNeeded flips on whether the hypothesis has a target user", () => {
  assert.equal(assessIcpFitConditions({ prompt: "x", hypothesis: {} }).namedCustomerNeeded, true);
  assert.equal(assessIcpFitConditions({ prompt: "x", hypothesis: { targetUser: "조은성" } }).namedCustomerNeeded, false);
});

test("diagnosis lines always name confirmed count and the conditions to confirm", () => {
  const partial = assessIcpFitConditions({ prompt: "전업 1인 개발자", hypothesis: {}, hasProjectPath: false });
  const lines = buildIcpFitDiagnosisLines(partial);
  assert.ok(lines[0].includes("ICP 적합 점검"));
  assert.ok(lines.some((l) => l.includes("확인 필요")));

  const full = assessIcpFitConditions({
    prompt: "전업 1인 개발자, 수익 0원, macOS, Codex, 매일 기록",
    hypothesis: {}, hasProjectPath: true,
  });
  const fullLines = buildIcpFitDiagnosisLines(full);
  assert.ok(fullLines.some((l) => l.includes("모두 확인")));
});

test("buildNamedCustomerNextAction forces naming a real person, not the placeholder", () => {
  const action = buildNamedCustomerNextAction("결제 공포");
  assert.ok(action.includes("실명"));
  assert.ok(action.includes("결제 공포"));
  assert.ok(!action.includes("아직 좁히는 중인 고객 후보"));
});

test("detectCustomerAvoidance names the costume when the prompt deflects to building", () => {
  // Deflection to code/demo with no customer focus -> costume note.
  assert.ok(detectCustomerAvoidance("일단 온보딩 코드를 좀 더 다듬고 데모를 멋지게 만든 다음에 보여줄게요").includes("코스튬"));
  // Customer-focused prompt -> no costume note even if it mentions a demo.
  assert.equal(detectCustomerAvoidance("오늘 고객 1명에게 데모 보내고 결제 의향 물어볼게요"), "");
  // Neutral prompt -> no note.
  assert.equal(detectCustomerAvoidance("오늘 뭐부터 할까요?"), "");
});

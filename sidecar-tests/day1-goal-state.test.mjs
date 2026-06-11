import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDay1GoalSelection } from "../sidecar/day1-goal-state.mjs";

test("Day 1 goal normalization strips duplicated problem text from customer and goal", () => {
  const selection = normalizeDay1GoalSelection({
    goalType: "get_users",
    goalText: "전업 1인 개발자 (수익 0원, macOS) 중 \"만들 줄은 알지만 무엇을 팔아야 하는지 모른다\"…를 실제 유입/가입 행동으로 모아 만들 줄은 알지만 무엇을 팔아야 하는지 모른다이 반복되는지 확인한다.",
    customer: "전업 1인 개발자 (수익 0원, macOS) 중 \"만들 줄은 알지만 무엇을 팔아야 하는지 모른다\"…",
    problem: "만들 줄은 알지만 무엇을 팔아야 하는지 모른다",
    validationAction: "지불 의향과 현재 대안을 첫 고객 대화에서 묻는다.",
    proofSink: "local",
    evidenceRefs: ["docs/ICP.md", "docs/SPEC.md"],
    sourcePlanFingerprint: "fixture",
    selectedAt: "2026-06-07T00:00:00.000Z",
  });

  assert.equal(selection.customer, "전업 1인 개발자 (수익 0원, macOS)");
  assert.equal(selection.goalText, "30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다.");
});

test("Day 1 get_users goal normalization upgrades old signup-count target to active users", () => {
  const selection = normalizeDay1GoalSelection({
    goalType: "get_users",
    goalText: "30일 안에 가입자 100명을 모은다.",
    customer: "B2B SaaS founder",
    problem: "온보딩에서 이탈한다",
    validationAction: "첫 핵심 행동 완료를 측정한다.",
    proofSink: "local",
    selectedAt: "2026-06-07T00:00:00.000Z",
  });

  assert.equal(selection.goalText, "30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다.");
});

test("Day 1 goal normalization repairs legacy sentence-composition artifacts", () => {
  const selection = normalizeDay1GoalSelection({
    goalType: "make_money",
    goalText: "전업 1인 개발자 (수익 0원, macOS)가 만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다에 돈이나 시간을 쓸지 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다.으로 확인한다.",
    customer: "전업 1인 개발자 (수익 0원, macOS)",
    problem: "만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다",
    validationAction: "지불 의향과 현재 대안을 첫 고객 대화에서 묻는다.",
    proofSink: "local",
    selectedAt: "2026-06-07T00:00:00.000Z",
  });

  assert.equal(selection.goalText, "30일 안에 첫 유료 결제 1건을 만든다.");
  assert.doesNotMatch(selection.goalText, /모른다에|[.!?。！？]으로 확인한다/);
});

test("Day 1 goal normalization preserves clean custom goal text", () => {
  const selection = normalizeDay1GoalSelection({
    goalType: "make_money",
    goalText: "이번 주 첫 유료 파일럿 후보 1명을 찾는다.",
    customer: "B2B SaaS support lead",
    problem: "Slack escalation을 놓침",
    validationAction: "현재 대안 확인",
    proofSink: "local",
    selectedAt: "2026-06-07T00:00:00.000Z",
  });

  assert.equal(selection.customer, "B2B SaaS support lead");
  assert.equal(selection.goalText, "이번 주 첫 유료 파일럿 후보 1명을 찾는다.");
});

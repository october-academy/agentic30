import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  OFFICE_HOURS_ARTIFACT_GATE_MIN_CYCLE,
  buildOfficeHoursEvidenceState,
  evidenceSidecarPath,
  officeHoursEvidenceHasHardEvidence,
} from "../sidecar/office-hours-evidence-state.mjs";
import {
  OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE,
  OFFICE_HOURS_HARD_EVIDENCE_MISSING_DEBT,
  buildOfficeHoursEvidenceJudgePrompt,
  deterministicOfficeHoursEvidenceJudge,
  judgeOfficeHoursEvidenceDocuments,
  parseOfficeHoursEvidenceJudgeJson,
} from "../sidecar/office-hours-evidence-judge.mjs";
import { writeAllDay1HandoffDocuments } from "../sidecar/idd-doc-gate.mjs";
import { projectDocPath } from "../sidecar/project-doc-paths.mjs";

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-oh-evidence-"));
  try {
    await fs.mkdir(path.join(root, ".agentic30", "memory"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeFailureFixture(root) {
  const turns = [
    turn({
      id: "turn-active",
      questionId: "get_users_active_user_definition",
      header: "활성 사용자 기준",
      question: "이 목표에서 활성 사용자 1명으로 세려면 고객 후보가 어떤 핵심 행동을 끝내야 하나요?",
      label: "첫 가치 완료",
      options: [
        option("첫 가치 완료", {
          mapsTo: "GOAL.activation_action",
          evidenceTarget: "첫 가치 완료 이벤트, 실행 기록, 검증 행동, 다음 과제",
          failureMode: "가입이나 관심 표현만 있으면 활성 사용자로 세지 않는다.",
          nextIntent: "first_value_completed",
        }),
      ],
    }),
    turn({
      id: "turn-target",
      questionId: "known_dev_first_segment",
      header: "고객 후보",
      question: "첫 10명 중 가장 절실한 고객 후보는 누구인가요?",
      label: "AI로 많이 만들었지만 팔지 못한 사람",
      options: [
        option("AI로 많이 만들었지만 팔지 못한 사람", {
          mapsTo: "ICP.desperate_segment",
          evidenceTarget: "최근 30일 안에 만든 제품과 판매 실패 기록",
        }),
      ],
    }),
    turn({
      id: "turn-channel",
      questionId: "first_channel",
      header: "첫 접점",
      question: "이번 주 직접 만날 수 있는 첫 고객 접점은 어디인가요?",
      label: "이미 아는 1인 개발자",
      options: [
        option("이미 아는 1인 개발자", {
          mapsTo: "ICP.first_reach_channel",
          evidenceTarget: "실명 후보 3명과 DM 발송 기록",
        }),
      ],
    }),
    turn({
      id: "turn-alternative",
      questionId: "current_alternative",
      header: "현재 대안",
      question: "지금 이 문제를 어떤 현재 대안으로 버티고 있나요?",
      label: "혼자 더 만들기",
      options: [
        option("혼자 더 만들기", {
          mapsTo: "PROBLEM.status_quo",
          evidenceTarget: "최근 2주 기능 개발 12시간, 고객 대화 0명",
          failureMode: "고객 접촉 없이 기능만 늘리면 수요 공백이 남는다.",
        }),
      ],
      freeText: "최근 2주 동안 기능 개발은 12시간, 고객 대화는 0명이다.",
    }),
    turn({
      id: "turn-activation",
      questionId: "activation_action",
      header: "검증 행동",
      question: "이번 주 반드시 끝내야 하는 검증 행동은 무엇인가요?",
      label: "실명 고객 3명에게 연락",
      options: [
        option("실명 고객 3명에게 연락", {
          mapsTo: "GOAL.activation_action",
          evidenceTarget: "실명 고객 3명 연락 완료와 답변 기록",
          failureMode: "오늘 3명에게 보내지 못하면 이번 cycle은 실패다.",
        }),
      ],
    }),
    turn({
      id: "turn-entry",
      questionId: "smallest_paid_entry",
      header: "작은 유료 진입점",
      question: "가장 작은 유료 진입점은 무엇인가요?",
      label: "1회 검증 세션",
      options: [
        option("1회 검증 세션", {
          mapsTo: "SPEC.smallest_paid_entry",
          evidenceTarget: "3만원 유료 세션 제안, 일정 확정 또는 결제 의향",
          failureMode: "가격이나 일정이 없으면 관심 신호로 낮춘다.",
          nextIntent: "concrete_purchase_conditions",
        }),
      ],
      freeText: "첫 paid entry는 3만원 1회 검증 세션이다.",
    }),
    turn({
      id: "turn-day2-signal",
      day: 2,
      questionId: "day2_market_signal",
      header: "외부 시장 신호",
      question: "오늘 외부 시장 신호로 무엇이 생겼나요?",
      label: "실명 고객 3명 연락 완료",
      options: [
        option("실명 고객 3명 연락 완료", {
          mapsTo: "GOAL.market_signal",
          evidenceTarget: "요청 발송 증거 있음, 이제 시간 확정 받기",
          failureMode: "시간 확정이 0명이면 이번 cycle은 실패다.",
        }),
      ],
      freeText: "요청 발송 증거 있음. 다음은 시간 확정 받기.",
    }),
  ];
  await fs.writeFile(
    path.join(root, ".agentic30", "memory", "office-hours-turns.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      schema: "agentic30.office_hours_turns.v1",
      updatedAt: "2026-06-13T00:00:00.000Z",
      turns,
    }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, ".agentic30", "memory", "office-hours-ledger.json"),
    `${JSON.stringify({
      schemaVersion: 3,
      schema: "agentic30.office_hours_memory.v1",
      updatedAt: "2026-06-13T00:00:00.000Z",
      commitments: [
        {
          id: "cm-1",
          cycle: 1,
          createdDay: 1,
          createdAt: "2026-06-12T00:00:00.000Z",
          text: "AI로 만들고 못 판 지인에게 오늘 30분 통화 요청",
          status: "met",
          evidence: "요청 발송 증거 있음",
          dueDay: 2,
          confirmedByUser: true,
        },
        {
          id: "cm-2",
          cycle: 2,
          createdDay: 2,
          createdAt: "2026-06-13T00:00:00.000Z",
          text: "그 지인에게 지금 15분 통화 가능 여부를 물어라",
          status: "open",
          dueDay: 2,
          confirmedByUser: true,
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, ".agentic30", "office-hours-daily-digest.json"),
    `${JSON.stringify({
      generatedAt: "2026-06-13T00:00:00.000Z",
      day: 2,
      briefing: {
        goalStatus: ["실명 고객 3명 연락 완료, 시간 확정 받기 필요"],
        biggestEvidenceGap: ["돈 신호와 시간 확정"],
      },
      buildWithoutCustomerEvidence: false,
    }, null, 2)}\n`,
    "utf8",
  );
}

test("Office Hours evidence reducer restores Day1/Day2 facts from turn logs", async () => {
  await withTempWorkspace(async (root) => {
    await writeFailureFixture(root);

    const evidence = await buildOfficeHoursEvidenceState({
      workspaceRoot: root,
      day1Handoff: shallowHandoff(),
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    assert.equal(evidence.facts.targetUser, "AI로 많이 만들었지만 팔지 못한 사람");
    assert.equal(evidence.facts.currentAlternative, "혼자 더 만들기");
    assert.equal(evidence.facts.entryPoint, "1회 검증 세션");
    assert.equal(evidence.facts.activationAction, "실명 고객 3명에게 연락");
    assert.match(evidence.facts.threshold, /이번 주까지/);
    assert.match(evidence.facts.failureCondition, /시간 확정|cycle/);
    assert.match(evidence.facts.pressureCost, /최근 2주 기능 개발 12시간/);
    assert.match(evidence.nextQuestion, /그 지인에게 지금 15분 통화 가능 여부/);
    assert.match(evidence.nextQuestion, /혼자 더 만들기/);
    assert.ok(evidence.references.some((ref) => ref.sourceType === "office_hours_turn" && ref.id === "turn-entry"));
  });
});

test("Day1 handoff uses reducer output, judge pass, and writes evidence sidecars", async () => {
  await withTempWorkspace(async (root) => {
    await writeFailureFixture(root);
    const result = await writeAllDay1HandoffDocuments(root, {}, {
      provider: "deterministic",
      runEvidenceJudge: true,
      day1Handoff: shallowHandoff(),
    });

    assert.equal(result.blocked, false);
    assert.equal(result.state.status, "approved");
    assert.equal(result.judgeResult.passed, true);
    assert.ok(result.judgeResult.score >= 8);
    assert.match(result.evidenceDebtCard, /증거부채|다음 질문/);

    const goal = await fs.readFile(path.join(root, projectDocPath("goal")), "utf8");
    assert.match(goal, /판단 지표/);
    assert.match(goal, /기준값\/기한: 이번 주까지/);
    assert.match(goal, /실패 조건: 시간 확정이 0명이면 이번 cycle은 실패다/);
    assert.doesNotMatch(goal, /기준값\/기한: 확인 필요/);

    const icp = await fs.readFile(path.join(root, projectDocPath("icp")), "utf8");
    assert.match(icp, /AI로 많이 만들었지만 팔지 못한 사람/);
    assert.match(icp, /현재 대안/);
    assert.match(icp, /혼자 더 만들기/);
    assert.match(icp, /최근 2주 기능 개발 12시간/);
    assert.match(icp, /Anti-ICP|제외할 고객/);

    const spec = await fs.readFile(path.join(root, projectDocPath("spec")), "utf8");
    assert.match(spec, /1회 검증 세션/);
    assert.match(spec, /실명 고객 3명에게 연락/);
    assert.match(spec, /Out of Scope/);

    const values = await fs.readFile(path.join(root, projectDocPath("values")), "utf8");
    assert.match(values, /누적되는 압박/);
    assert.match(values, /행동 증거 우선/);

    const sidecar = JSON.parse(
      await fs.readFile(path.join(root, evidenceSidecarPath(projectDocPath("goal"))), "utf8"),
    );
    assert.equal(sidecar.schemaVersion, 1);
    assert.equal(sidecar.docType, "goal");
    assert.ok(sidecar.localReferences.some((ref) => ref.sourceType === "office_hours_turn"));
    assert.ok(sidecar.localReferences.some((ref) => ref.id === "cm-2"));
    assert.equal(sidecar.lastJudgeResult.passed, true);
    assert.ok(sidecar.lastJudgeResult.score >= 8);
  });
});

test("Deterministic judge fails incomplete docs that only share a stray token", async () => {
  await withTempWorkspace(async (root) => {
    await writeFailureFixture(root);
    // Rich, intact reducer facts — the *docs* are what is deliberately shallow.
    const evidenceState = await buildOfficeHoursEvidenceState({
      workspaceRoot: root,
      day1Handoff: shallowHandoff(),
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    // Each doc shares only a single stray token with its multi-word facts
    // (e.g. "완료"/"이번" with the metric/threshold/failure-condition, "사람"
    // with the target user, "세션"/"연락" with the entry point/activation
    // action). The previous `.some` matcher accepted any single 2-char token,
    // so these stubs scored a false-positive pass. The tightened matcher needs
    // a verbatim phrase or a strict majority of tokens, so they must now fail.
    const incompleteDocuments = {
      goal: "# GOAL\n\n## 현재 측정 계약\n- 이번 흐름에서 완료를 본다.\n- 측정 지표를 정한다.",
      icp: "# ICP\n\n## 고객\n- 한 사람.\n\n## 대안\n- 다른 만들기 방식.",
      spec: "# SPEC\n\n## 흐름\n- 세션을 연다.\n- 연락 과정.",
      values: "# VALUES\n\n- 빠르게 만든다.",
    };

    const verdict = deterministicOfficeHoursEvidenceJudge({
      evidenceState,
      documents: incompleteDocuments,
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    assert.equal(verdict.passed, false);
    assert.ok(verdict.score < OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE, `expected score < ${OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE}, got ${verdict.score}`);

    const criterion = (id) => verdict.criteria.find((item) => item.id === id);
    // These three are driven by docIncludes(); under the old single-token
    // matcher they all passed against the stubs above. They must now fail.
    assert.equal(criterion("goal_measurement_contract").passed, false);
    assert.equal(criterion("icp_behavior_situation").passed, false);
    assert.equal(criterion("spec_entry_and_loop").passed, false);
  });
});

test("Deterministic judge requires discriminating numeral tokens, not just a token majority", async () => {
  await withTempWorkspace(async (root) => {
    await writeFailureFixture(root);
    const evidenceState = await buildOfficeHoursEvidenceState({
      workspaceRoot: root,
      day1Handoff: shallowHandoff(),
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    // spec shares a strict MAJORITY of the generic tokens with the entry point
    // ("검증"+"세션" of "1회 검증 세션") and the activation action ("실명"+"고객"
    // +"연락" of "실명 고객 3명에게 연락"), but deliberately drops the numerals
    // "1회" and "3명에게" — the part that actually pins a paid entry point and a
    // quantified contract. A bare-majority matcher would accept this doc; the
    // matcher must reject it because a digit-bearing fact token is missing.
    const numeralDroppedDocuments = {
      goal: "# GOAL\n- 측정.",
      icp: "# ICP\n- 고객.",
      spec: "# SPEC\n\n## 흐름\n- 검증 세션을 매주 연다.\n- 실명 고객에게 직접 연락한다.",
      values: "# VALUES\n- 가치.",
    };

    const verdict = deterministicOfficeHoursEvidenceJudge({
      evidenceState,
      documents: numeralDroppedDocuments,
      now: () => new Date("2026-06-13T00:00:00.000Z"),
    });

    assert.equal(verdict.passed, false);
    const specEntry = verdict.criteria.find((item) => item.id === "spec_entry_and_loop");
    assert.equal(specEntry.passed, false);
  });
});

test("Day1 handoff blocks auto-save and records debt report when judge fails", async () => {
  await withTempWorkspace(async (root) => {
    await writeFailureFixture(root);
    const result = await writeAllDay1HandoffDocuments(root, {}, {
      provider: "codex",
      runEvidenceJudge: true,
      day1Handoff: shallowHandoff(),
      judgeOfficeHoursDocs: async () => ({
        status: "failed",
        passed: false,
        score: 6,
        summary: "Anti-ICP reason is still too weak.",
        followUpQuestions: ["어떤 고객을 명시적으로 제외해야 하나요?"],
        evidenceDebt: ["Anti-ICP reason missing"],
      }),
    });

    assert.equal(result.blocked, true);
    assert.equal(result.state.status, "error");
    await assert.rejects(
      fs.readFile(path.join(root, projectDocPath("goal")), "utf8"),
      /ENOENT/,
    );
    const debt = JSON.parse(
      await fs.readFile(path.join(root, ".agentic30", "docs", "OFFICE_HOURS_EVIDENCE_DEBT.json"), "utf8"),
    );
    assert.equal(debt.lastJudgeResult.score, 6);
    assert.ok(debt.evidenceDebt.length > 0);
  });
});

test("Office Hours evidence judge contract requires docs plus next question and enforces 8+ threshold", () => {
  const prompt = buildOfficeHoursEvidenceJudgePrompt({
    evidenceState: {
      facts: {
        targetUser: "AI로 많이 만들었지만 팔지 못한 사람",
        currentAlternative: "혼자 더 만들기",
      },
      nextQuestion: "그 지인은 혼자 더 만들기에 최근 2주 동안 돈이나 시간을 얼마나 쓰고 있나요?",
    },
    documents: {
      goal: "# GOAL\n\n기준값/기한: 이번 주까지 1명",
      icp: "# ICP\n\n현재 대안: 혼자 더 만들기",
      spec: "# SPEC\n\n작은 유료 진입점: 1회 검증 세션",
      values: "# VALUES\n\n누적되는 압박",
    },
    bestPracticeDocs: {
      goal: "# GOAL reference",
      icp: "# ICP reference",
      spec: "# SPEC reference",
      values: "# VALUES reference",
    },
  });

  assert.match(prompt, new RegExp(`score >= ${OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE}/10`));
  assert.match(prompt, /Best-practice reference docs/);
  assert.match(prompt, /nextQuestion/);

  const parsed = parseOfficeHoursEvidenceJudgeJson(JSON.stringify({
    score: OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE - 1,
    passed: true,
    summary: "Too shallow.",
    criteria: [
      { id: "goal_measurement_contract", passed: true, reason: "Looks plausible." },
    ],
    follow_up_questions: ["어떤 실패 조건이면 중단하나요?"],
    evidence_debt: ["failure condition missing"],
  }));
  assert.equal(parsed.passed, false);
  assert.equal(parsed.score, OFFICE_HOURS_EVIDENCE_JUDGE_PASS_SCORE - 1);
});

test("Hard-evidence gate blocks self-report-only evidence and records debt (ER-1)", async () => {
  const documents = { goal: "x", icp: "x", spec: "x", values: "x" };
  const selfReport = {
    references: [{ sourceType: "office_hours_turn", id: "t1", nextIntent: "verbal_interest_or_no_evidence" }],
    facts: {},
    nextQuestion: "",
  };
  const withHard = {
    references: [{ sourceType: "office_hours_turn", id: "t1", nextIntent: "actual_payment_or_contract" }],
    facts: {},
    nextQuestion: "",
  };
  const r1 = await judgeOfficeHoursEvidenceDocuments({ provider: "deterministic", evidenceState: selfReport, documents });
  assert.equal(r1.passed, false);
  assert.ok((r1.evidenceDebt || []).includes(OFFICE_HOURS_HARD_EVIDENCE_MISSING_DEBT));
  // With hard evidence present the gate stops adding the debt (the verdict may
  // still fail for weak docs, but not because hard evidence is missing).
  const r2 = await judgeOfficeHoursEvidenceDocuments({ provider: "deterministic", evidenceState: withHard, documents });
  assert.ok(!(r2.evidenceDebt || []).includes(OFFICE_HOURS_HARD_EVIDENCE_MISSING_DEBT));
  // Active-user *definition* grades are NOT hard evidence (they define what
  // counts as active, not proof it happened) — must still fail closed.
  const definitionOnly = {
    references: [{ sourceType: "office_hours_turn", id: "t2", nextIntent: "first_value_completed" }],
    facts: {},
    nextQuestion: "",
  };
  const r3 = await judgeOfficeHoursEvidenceDocuments({ provider: "deterministic", evidenceState: definitionOnly, documents });
  assert.ok((r3.evidenceDebt || []).includes(OFFICE_HOURS_HARD_EVIDENCE_MISSING_DEBT));
  // A hard intent on a non-turn reference (e.g. commitment) must not count.
  const commitmentIntent = {
    references: [{ sourceType: "office_hours_commitment", id: "cm", nextIntent: "actual_payment_or_contract" }],
    facts: {},
    nextQuestion: "",
  };
  const r4 = await judgeOfficeHoursEvidenceDocuments({ provider: "deterministic", evidenceState: commitmentIntent, documents });
  assert.ok((r4.evidenceDebt || []).includes(OFFICE_HOURS_HARD_EVIDENCE_MISSING_DEBT));
});

test("Day1 handoff fails closed when judge is requested but workspace has no evidence (GATE-01)", async () => {
  await withTempWorkspace(async (root) => {
    const result = await writeAllDay1HandoffDocuments(root, {}, {
      provider: "deterministic",
      runEvidenceJudge: true,
      day1Handoff: shallowHandoff(),
    });
    assert.equal(result.blocked, true);
    assert.equal(result.judgeResult.passed, false);
    assert.ok((result.judgeResult.evidenceDebt || []).includes(OFFICE_HOURS_HARD_EVIDENCE_MISSING_DEBT));
    assert.equal(result.written.length, 0);
  });
});

test("Reducer dedupes duplicate turns so references and confidence do not inflate (IDEM-1)", async () => {
  await withTempWorkspace(async (root) => {
    const dup = turn({
      id: "turn-alternative",
      questionId: "current_alternative",
      header: "현재 대안",
      question: "지금 이 문제를 어떤 현재 대안으로 버티고 있나요?",
      label: "혼자 더 만들기",
      options: [option("혼자 더 만들기", { mapsTo: "PROBLEM.status_quo", evidenceTarget: "x", nextIntent: "verbal_interest_or_no_evidence" })],
    });
    await fs.writeFile(
      path.join(root, ".agentic30", "memory", "office-hours-turns.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        schema: "agentic30.office_hours_turns.v1",
        updatedAt: "2026-06-13T00:00:00.000Z",
        turns: [dup, dup, dup, dup],
      }, null, 2)}\n`,
      "utf8",
    );
    const state = await buildOfficeHoursEvidenceState({ workspaceRoot: root, day1Handoff: {} });
    const turnRefs = (state.references || []).filter((ref) => ref.sourceType === "office_hours_turn");
    assert.equal(turnRefs.length, 1);
  });
});

test("Provider judge path parses stream output and applies the hard-evidence gate (TQ-3)", async () => {
  const savedStub = process.env.AGENTIC30_TEST_STUB_PROVIDER;
  const savedMode = process.env.AGENTIC30_OFFICE_HOURS_DOC_JUDGE_MODE;
  delete process.env.AGENTIC30_TEST_STUB_PROVIDER;
  delete process.env.AGENTIC30_OFFICE_HOURS_DOC_JUDGE_MODE;
  try {
    const documents = { goal: "x", icp: "x", spec: "x", values: "x" };
    const judgeJson = (score) => JSON.stringify({
      score,
      passed: true,
      summary: "ok",
      criteria: [{ id: "c1", passed: true, reason: "근거" }],
      follow_up_questions: ["다음 질문"],
      evidence_debt: [],
    });
    // Real provider stream path: runJudge output is parsed and the 8+ threshold honored.
    const pass = await judgeOfficeHoursEvidenceDocuments({
      provider: "claude",
      evidenceState: { references: [{ sourceType: "office_hours_turn", nextIntent: "actual_payment_or_contract" }], facts: {}, nextQuestion: "" },
      documents,
      runJudge: async () => "```json\n" + judgeJson(9) + "\n```",
    });
    assert.equal(pass.passed, true);
    assert.equal(pass.score, 9);
    // Even a perfect provider score cannot pass when hard evidence is missing.
    const blocked = await judgeOfficeHoursEvidenceDocuments({
      provider: "claude",
      evidenceState: { references: [{ sourceType: "office_hours_turn", nextIntent: "verbal_interest_or_no_evidence" }], facts: {}, nextQuestion: "" },
      documents,
      runJudge: async () => judgeJson(10),
    });
    assert.equal(blocked.passed, false);
    assert.ok((blocked.evidenceDebt || []).includes(OFFICE_HOURS_HARD_EVIDENCE_MISSING_DEBT));
  } finally {
    if (savedStub !== undefined) process.env.AGENTIC30_TEST_STUB_PROVIDER = savedStub;
    if (savedMode !== undefined) process.env.AGENTIC30_OFFICE_HOURS_DOC_JUDGE_MODE = savedMode;
  }
});

async function writeArtifactGateFixture(root, { turns = [], commitments = [] }) {
  await fs.mkdir(path.join(root, ".agentic30", "memory"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".agentic30", "memory", "office-hours-turns.json"),
    `${JSON.stringify({ schemaVersion: 1, schema: "agentic30.office_hours_turns.v1", updatedAt: "2026-06-13T00:00:00.000Z", turns }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(root, ".agentic30", "memory", "office-hours-ledger.json"),
    `${JSON.stringify({ schemaVersion: 3, schema: "agentic30.office_hours_memory.v1", updatedAt: "2026-06-13T00:00:00.000Z", commitments }, null, 2)}\n`,
    "utf8",
  );
}

async function writeProofLedgerFixture(root, events) {
  await fs.mkdir(path.join(root, ".agentic30"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".agentic30", "proof-ledger.json"),
    `${JSON.stringify({ schema: "agentic30.proof_ledger.v2", events }, null, 2)}\n`,
    "utf8",
  );
}

function paidEntryTurn(day = 1) {
  return turn({
    id: "turn-paid",
    day,
    questionId: "smallest_paid_entry",
    header: "작은 유료 진입점",
    question: "가장 작은 유료 진입점은 무엇인가요?",
    label: "3만원 1회 검증 세션",
    options: [option("3만원 1회 검증 세션", { mapsTo: "SPEC.smallest_paid_entry", nextIntent: "actual_payment_or_contract" })],
  });
}

function cycleCommitment(cycle) {
  return {
    id: `cm-c${cycle}`,
    cycle,
    createdDay: cycle,
    createdAt: "2026-06-13T00:00:00.000Z",
    text: `cycle ${cycle} 약속`,
    status: "open",
    dueDay: cycle,
    confirmedByUser: true,
  };
}

test("Artifact gate: early cycle passes on ladder intent alone (cycle < MIN_CYCLE)", async () => {
  await withTempWorkspace(async (root) => {
    await writeArtifactGateFixture(root, { turns: [paidEntryTurn(1)], commitments: [cycleCommitment(1)] });
    const state = await buildOfficeHoursEvidenceState({ workspaceRoot: root, day1Handoff: {} });
    assert.equal(officeHoursEvidenceHasHardEvidence(state), true);
  });
});

test("Artifact gate: at MIN_CYCLE, ladder alone is blocked without a payment_record", async () => {
  await withTempWorkspace(async (root) => {
    await writeArtifactGateFixture(root, { turns: [paidEntryTurn(1)], commitments: [cycleCommitment(OFFICE_HOURS_ARTIFACT_GATE_MIN_CYCLE)] });
    const state = await buildOfficeHoursEvidenceState({ workspaceRoot: root, day1Handoff: {} });
    assert.equal(officeHoursEvidenceHasHardEvidence(state), false);
  });
});

test("Artifact gate: at MIN_CYCLE, ladder + verified strong payment_record passes", async () => {
  await withTempWorkspace(async (root) => {
    await writeArtifactGateFixture(root, { turns: [paidEntryTurn(1)], commitments: [cycleCommitment(OFFICE_HOURS_ARTIFACT_GATE_MIN_CYCLE)] });
    await writeProofLedgerFixture(root, [{ id: "pe-1", type: "payment_record", status: "verified", strength: "strong", day: 5 }]);
    const state = await buildOfficeHoursEvidenceState({ workspaceRoot: root, day1Handoff: {} });
    assert.equal(officeHoursEvidenceHasHardEvidence(state), true);
  });
});

test("Artifact gate: at MIN_CYCLE, unqualified payment evidence stays blocked", async () => {
  await withTempWorkspace(async (root) => {
    const fixture = { turns: [paidEntryTurn(1)], commitments: [cycleCommitment(OFFICE_HOURS_ARTIFACT_GATE_MIN_CYCLE)] };
    // (a) payment_intent excluded even when stamped strong (inferProofStrength loophole)
    await writeArtifactGateFixture(root, fixture);
    await writeProofLedgerFixture(root, [{ id: "pe-a", type: "payment_intent", status: "verified", strength: "strong", day: 5 }]);
    assert.equal(officeHoursEvidenceHasHardEvidence(await buildOfficeHoursEvidenceState({ workspaceRoot: root, day1Handoff: {} })), false);
    // (b) payment_record but draft status
    await writeProofLedgerFixture(root, [{ id: "pe-b", type: "payment_record", status: "draft", strength: "strong", day: 5 }]);
    assert.equal(officeHoursEvidenceHasHardEvidence(await buildOfficeHoursEvidenceState({ workspaceRoot: root, day1Handoff: {} })), false);
    // (c) payment_record verified but medium strength
    await writeProofLedgerFixture(root, [{ id: "pe-c", type: "payment_record", status: "verified", strength: "medium", day: 5 }]);
    assert.equal(officeHoursEvidenceHasHardEvidence(await buildOfficeHoursEvidenceState({ workspaceRoot: root, day1Handoff: {} })), false);
  });
});

function shallowHandoff() {
  return {
    goal: "30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다.",
    icp: "첫 고객 후보",
    pain: "검증할 문제",
    outcome: "혼자 더 만들기",
  };
}

function option(label, extra = {}) {
  return {
    label,
    description: `${label} 선택`,
    ...extra,
  };
}

function turn({
  id,
  day = 1,
  questionId,
  header,
  question,
  label,
  options,
  freeText = "",
}) {
  return {
    id,
    day,
    sessionId: "session-office-hours",
    requestId: `${id}-request`,
    signalId: questionId,
    signalLabel: header,
    questionText: question,
    responseText: label,
    responseDescription: options.find((item) => item.label === label)?.description || "",
    promptSnapshot: {
      requestId: `${id}-request`,
      sessionId: "session-office-hours",
      toolName: "agentic30_request_user_input",
      title: "Office Hours",
      createdAt: "2026-06-13T00:00:00.000Z",
      questions: [
        {
          questionId,
          header,
          question,
          options,
          allowFreeText: true,
          requiresFreeText: false,
          freeTextPlaceholder: "예: 선택지에 없으면 실제 상황을 직접 입력",
        },
      ],
      generation: {
        mode: "office_hours_tool",
        signalId: questionId,
        signalLabel: header,
      },
    },
    submissions: [
      {
        question,
        selectedOptions: [label],
        freeText,
      },
    ],
    occurredAt: "2026-06-13T00:00:00.000Z",
  };
}

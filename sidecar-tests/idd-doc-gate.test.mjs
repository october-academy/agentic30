import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  BIP_REQUIRED_LOCAL_DOCS,
  DAY1_HANDOFF_MARKER_START,
  DAY1_HANDOFF_MARKER_END,
  IDD_AMBIGUITY_THRESHOLD,
  agentSynthesisTargetsCorrectSignal,
  approveIddSetupDocuments,
  buildAdaptiveIcpInitialInput,
  buildIddFollowupStructuredInputForDoc,
  buildIddContinuationPrompt,
  buildIddDocumentPrompt,
  calculateIddAmbiguityRubric,
  decorateIcpStructuredInput,
  dedupeIddAgentOptions,
  deriveLocalDocReadinessRows,
  docTypeFromLocalRowId,
  getBipSetupGateStatus,
  iddOptionContentTokens,
  iddOptionTokenJaccard,
  initialIddStructuredInputForDoc,
  isLegacyStaticIddUserInputRequest,
  isMissingIcpContextIntro,
  isStaleAwkwardIcpUserInputRequest,
  isStaleGenericHostIddUserInputRequest,
  localDocRowId,
  mergeDay1HandoffBlock,
  recordIddStructuredResponse,
  serializeIddSetupFields,
  setIddSetupError,
  writeAllDay1HandoffDocuments,
  writeDay1HandoffDocument,
} from "../sidecar/idd-doc-gate.mjs";
import { projectDocPath } from "../sidecar/project-doc-paths.mjs";

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-gate-"));
  try {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function countTopLevelHeadings(content) {
  return [...String(content || "").matchAll(/^# /gm)].length;
}

test("BIP setup gate requires all local docs and Google links", async () => {
  await withTempWorkspace(async (root) => {
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\n");

    const gate = getBipSetupGateStatus({
      workspaceRoot: root,
      bipCoachState: { config: { docId: "doc-1", sheetId: "sheet-1" } },
    });

    assert.equal(gate.ready, false);
    assert.equal(gate.missingLocalDocs.length, BIP_REQUIRED_LOCAL_DOCS.length - 1);
    assert.equal(gate.nextLocalDoc.type, "spec");
    assert.deepEqual(gate.missingExternalRequirements, []);
  });
});

test("BIP setup gate passes with canonical local docs and external links", async () => {
  await withTempWorkspace(async (root) => {
    const files = [
      ".agentic30/docs/ICP.md",
      ".agentic30/docs/SPEC.md",
      ".agentic30/docs/VALUES.md",
      ".agentic30/docs/DESIGN_SYSTEM.md",
      ".agentic30/docs/ADR.md",
      ".agentic30/docs/GOAL.md",
      ".agentic30/docs/DOCS.md",
      ".agentic30/docs/SHEET.md",
    ];
    for (const file of files) {
      await fs.writeFile(path.join(root, file), `# ${file}\n`);
    }

    const gate = getBipSetupGateStatus({
      workspaceRoot: root,
      bipCoachState: { config: { docId: "doc-1", sheetId: "sheet-1" } },
    });

    assert.equal(gate.ready, true);
    assert.equal(gate.missingLocalDocs.length, 0);
    assert.equal(gate.missingExternalRequirements.length, 0);
  });
});

test("local doc readiness rows use canonical row ids and pending detail", async () => {
  await withTempWorkspace(async (root) => {
    const rows = deriveLocalDocReadinessRows(root);

    assert.equal(rows[0].id, "localIcp");
    assert.equal(rows[0].status, "pending");
    assert.match(rows[0].detail, /docs\/ICP\.md/);
    assert.equal(docTypeFromLocalRowId(localDocRowId("designSystem")), "designSystem");
  });
});

test("IDD ambiguity rubric starts at 100 and uses missing signals instead of document count", () => {
  const empty = calculateIddAmbiguityRubric({ transcript: [], drafts: {} });
  const shallow = recordIddStructuredResponse({}, {
    doc: BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp"),
    provider: "codex",
    responseText: "개발자",
  });

  assert.equal(empty.score, 100);
  assert.equal(shallow.status, "interviewing");
  assert.ok(shallow.ambiguityScore > 75);
  assert.equal(shallow.ambiguityRubric.docs.find((doc) => doc.type === "icp").blocked, true);
  assert.match(shallow.unresolvedAssumptions.join("\n"), /실제 사람|현재 대안|압박/);
});

test("IDD follow-up targets the highest missing signal for the current document", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  const state = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "유료 고객 0명인 macOS 1인 개발자",
  });
  const input = buildIddFollowupStructuredInputForDoc(doc, state);

  assert.equal(input.toolName, "agentic30_request_user_input");
  assert.equal(input.title, "Ideal Customer Profile · 직접 만날 사람");
  assert.equal(input.generation?.docType, "icp");
  assert.equal(input.generation?.signalId, "reachable_person");
  assert.equal(input.generation?.signalLabel, "직접 만날 사람");
  assert.match(input.questions[0].helperText, /Ambiguity/);
  assert.match(input.questions[0].question, /연락하거나 관찰/);
  assert.equal(input.questions[0].allowFreeText, true);
  assert.equal(input.questions[0].requiresFreeText, false);
});

test("ICP follow-up surfaces dimension transition chip and breadcrumb metadata", () => {
  // PR1: prevent the "1/4 뺑뺑이" UX. After 2 narrow_segment answers the
  // rubric advances to reachable_person; the follow-up should now ship
  // previousAnswerLabel + dimensionStepIndex + a transition line in
  // helperText so the Mac UI can render the chip and 4-dot breadcrumb.
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  const after1 = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "퇴사 후 첫 매출이 없는 macOS 1인 개발자",
    signalId: "narrow_segment",
    signalLabel: "좁히기",
  });
  const after2 = recordIddStructuredResponse(after1, {
    doc,
    provider: "codex",
    responseText: "AI 코딩 도구를 매일 쓰는 풀타임 1인 개발자",
    signalId: "narrow_segment",
    signalLabel: "좁히기",
  });
  const followup = buildIddFollowupStructuredInputForDoc(doc, after2);

  assert.equal(followup.generation?.signalId, "reachable_person");
  assert.equal(followup.generation?.dimensionTransitioned, true);
  assert.equal(followup.generation?.previousSignalLabel, "좁히기");
  assert.equal(
    followup.generation?.previousAnswerLabel,
    "AI 코딩 도구를 매일 쓰는 풀타임 1인…",
    "previousAnswerLabel should be a 22-char slice of the most recent doc transcript response",
  );
  assert.equal(followup.generation?.dimensionStepIndex, 2, "reachable_person is the 2nd ICP signal (1-indexed)");
  assert.equal(followup.generation?.dimensionTotal, 4, "ICP has 4 rubric signals total");

  const helperText = followup.questions[0].helperText || "";
  assert.match(helperText, /방금/, "helperText should lead with the dimension transition line");
  assert.ok(helperText.includes("AI 코딩 도구를 매일 쓰는 풀타임 1인…"), "transition line should quote the previous answer");
  assert.ok(helperText.includes("직접 만날 사람"), "transition line should name the new dimension");
  assert.match(helperText, /Ambiguity/, "ambiguity score line should still be present");
});

test("ICP rubric auto-passes narrow_segment after 2+ answers to escape infinite narrowing", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  const after1 = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "출시했지만 반응이 약한 개발자",
  });
  const icpRubric1 = after1.ambiguityRubric.docs.find((entry) => entry.type === "icp");
  assert.equal(icpRubric1.missingSignals[0].id, "narrow_segment", "1 answer with short label keeps narrow_segment missing");

  const after2 = recordIddStructuredResponse(after1, {
    doc,
    provider: "codex",
    responseText: "방문자는 있지만 가입이 없는 웹 개발자",
  });
  const icpRubric2 = after2.ambiguityRubric.docs.find((entry) => entry.type === "icp");
  assert.notEqual(
    icpRubric2.missingSignals[0]?.id,
    "narrow_segment",
    "after 2 narrowing answers, rubric should advance off narrow_segment to next dimension",
  );
  assert.ok(
    icpRubric2.passedSignals.some((signal) => signal.id === "narrow_segment"),
    "narrow_segment should be auto-passed once user has answered ICP card 2 times",
  );

  const followup = buildIddFollowupStructuredInputForDoc(doc, after2);
  assert.doesNotMatch(
    followup.questions[0].question,
    /가장 좁은 고객 세그먼트/,
    "follow-up card should NOT keep asking to narrow segment further",
  );
});

test("VALUES follow-up questions ask for decisions instead of fallback evidence format", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "values");
  const cases = [
    {
      signalId: "tradeoff",
      header: "포기할 선택",
      responseText: "고객 인터뷰 기록",
      questionPattern: /실제로 포기할 선택/,
      optionPattern: /고객 인터뷰 기록/,
    },
    {
      signalId: "rejected_option",
      header: "거절 기준",
      responseText: "속도보다 증거를 우선한다.",
      questionPattern: /거절해야 하는 요청/,
      optionPattern: /속도|증거/,
    },
    {
      signalId: "trigger",
      header: "적용 상황",
      responseText: "속도보다 증거를 우선하고 새 기능은 하지 않는다.",
      questionPattern: /어떤 순간에 바로 적용/,
      optionPattern: /속도|증거/,
    },
    {
      signalId: "violation_example",
      header: "위반 예시",
      responseText: "속도보다 증거를 우선하고 새 기능은 하지 않는다. 사용자가 막히는 상황 때 이 원칙을 적용한다.",
      questionPattern: /어긴 것으로 기록/,
      optionPattern: /속도|증거/,
    },
  ];

  for (const entry of cases) {
    const state = {
      transcript: [{ docType: doc.type, responseText: entry.responseText }],
      drafts: {},
    };
    const input = buildIddFollowupStructuredInputForDoc(doc, state);
    const question = input.questions[0];

    assert.equal(input.title, `VALUES · ${entry.header}`);
    assert.equal(input.generation?.signalLabel, entry.header);
    assert.match(question.helperText, /Ambiguity/);
    assert.match(question.question, entry.questionPattern);
    assert.doesNotMatch(question.question, /이 빠진 근거를 한 줄로 보완/);
    assert.match(question.options.map((option) => option.label).join("\n"), entry.optionPattern);
    assert.doesNotMatch(
      question.options.map((option) => option.label).join("\n"),
      /새 기능 보류|자동화 보류|빠른 미션 오픈 보류|실제 사람\/상황|숫자\/기준|리스크\/실패 조건/,
    );
    assert.deepEqual(question.options.map((option) => option.nextIntent), [
      entry.signalId,
      entry.signalId,
      entry.signalId,
    ]);
    assert.equal(question.requiresFreeText, false);
    assert.equal(question.allowFreeText, true);
  }
});

test("VALUES follow-up falls back to generic copy only without usable prior answer", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "values");
  const emptyStates = [
    { transcript: [], drafts: {} },
    { transcript: [{ docType: doc.type, responseText: "" }], drafts: {} },
    { transcript: [{ docType: doc.type, responseText: "   \n\t" }], drafts: {} },
  ];

  for (const state of emptyStates) {
    const question = buildIddFollowupStructuredInputForDoc(doc, state).questions[0];
    assert.match(question.question, /이 빠진 근거/);
    assert.doesNotMatch(question.question, /방금 정한 원칙/);
    assert.deepEqual(
      question.options.map((option) => option.label),
      ["실제 사람/상황으로 보완", "숫자/기준으로 보완", "리스크/실패 조건으로 보완"],
    );
  }

  const unparseable = buildIddFollowupStructuredInputForDoc(doc, {
    transcript: [{ docType: doc.type, responseText: "고객 인터뷰 기록" }],
    drafts: {},
  }).questions[0];
  assert.match(unparseable.question, /실제로 포기할 선택/);
  assert.match(unparseable.options.map((option) => option.label).join("\n"), /고객 인터뷰 기록/);
  assert.doesNotMatch(unparseable.question, /이 빠진 근거/);

  const normalTradeoff = buildIddFollowupStructuredInputForDoc(doc, {
    transcript: [{ docType: doc.type, responseText: "속도보다 증거를 우선한다." }],
    drafts: {},
  }).questions[0];
  assert.match(normalTradeoff.question, /거절해야 하는 요청|실제로 포기할 선택/);
  assert.match(normalTradeoff.options.map((option) => option.label).join("\n"), /속도|증거/);
  assert.doesNotMatch(normalTradeoff.question, /방금 정한 원칙/);
});

test("initial IDD structured inputs are document-specific for GOAL, VALUES, and SPEC", () => {
  const docsByType = new Map(BIP_REQUIRED_LOCAL_DOCS.map((doc) => [doc.type, doc]));
  const goal = initialIddStructuredInputForDoc(docsByType.get("goal"), {
    provider: "codex",
    forceHostStructuredInput: true,
  });
  const values = initialIddStructuredInputForDoc(docsByType.get("values"), {
    provider: "codex",
    forceHostStructuredInput: true,
  });
  const spec = initialIddStructuredInputForDoc(docsByType.get("spec"), {
    provider: "codex",
    forceHostStructuredInput: true,
  });

  assert.equal(goal.title, "목표 정하기");
  assert.match(goal.questions[0].question, /목표/);
  assert.match(goal.questions[0].helperText, /proof target|목표/);
  assert.equal(goal.questions[0].requiresFreeText, false);

  assert.equal(values.title, "원칙 정하기");
  assert.match(values.questions[0].question, /tradeoff|거절 기준/);
  assert.match(values.questions[0].freeTextPlaceholder, /신뢰/);
  assert.equal(values.questions[0].requiresFreeText, false);

  assert.equal(spec.title, "첫 버전 정하기");
  assert.match(spec.questions[0].question, /핵심 작업 흐름/);
  assert.match(spec.questions[0].freeTextPlaceholder, /Day 1 미션/);
  assert.equal(spec.questions[0].requiresFreeText, false);
});

test("adaptive ICP self option labels support new onboarding roles", () => {
  const marketerInput = buildAdaptiveIcpInitialInput({
    onboardingContext: { role: "marketer_business" },
  });
  assert.match(marketerInput.questions[0].options[0].label, /마케터\/비즈니스 담당자/);

  const generalistInput = buildAdaptiveIcpInitialInput({
    onboardingContext: { role: "generalist" },
  });
  assert.match(generalistInput.questions[0].options[0].label, /여러 역할을 맡은 사람/);

  const legacyStudentInput = buildAdaptiveIcpInitialInput({
    onboardingContext: { role: "student" },
  });
  assert.match(legacyStudentInput.questions[0].options[0].label, /나 같은 학생/);
});

test("IDD setup error is serialized for the Mac surface", () => {
  const state = setIddSetupError({}, {
    provider: "codex",
    docType: "icp",
    message: "질문 카드 준비가 중단됐습니다.",
  });
  const event = serializeIddSetupFields(state);

  assert.equal(event.iddSetupStatus, "error");
  assert.equal(event.iddSetupComplete, false);
  assert.equal(event.iddSetupError.provider, "codex");
  assert.equal(event.iddSetupError.docType, "icp");
  assert.match(event.iddSetupError.message, /질문 카드 준비/);
});

test("IDD rubric drops below threshold only when all foundation docs contain required signals", async () => {
  await withTempWorkspace(async (root) => {
    let state = {};
    const byType = new Map(BIP_REQUIRED_LOCAL_DOCS.map((doc) => [doc.type, doc]));
    state = recordIddStructuredResponse(state, {
      doc: byType.get("icp"),
      provider: "codex",
      responseText: [
        "유료 고객 0명이고 macOS에서 Codex를 쓰는 전업 1인 개발자.",
        "이번 주 전 직장 동료 A님에게 DM으로 인터뷰 연락 가능.",
        "현재 Notion과 스프레드시트에 인터뷰 메모를 복사해 쓰는 대안.",
        "주 3시간 낭비와 월 20만원 도구비 압박.",
      ].join("\n"),
    });
    state = recordIddStructuredResponse(state, {
      doc: byType.get("goal"),
      provider: "codex",
      responseText: [
        "이번 주 proof target은 첫 인터뷰 카드 완료 3명.",
        "지표는 카드 시작 대비 완료 전환율과 응답 수.",
        "목표값은 3명 완료, 기한은 금요일.",
        "5명에게 연락해 0명이 과거 행동을 말하면 실패하고 ICP를 피벗.",
      ].join("\n"),
    });
    state = recordIddStructuredResponse(state, {
      doc: byType.get("values"),
      provider: "codex",
      responseText: [
        "tradeoff는 넓은 플랫폼 대신 이번 주 검증 행동을 우선 선택.",
        "예쁜 대시보드와 자동화 기능은 포기하고 나중으로 제외.",
        "사용자가 다음 행동을 못 고르는 상황 때 이 원칙을 적용.",
        "위반 예시는 인터뷰 없이 기능을 추가하면 안 된다는 금지 행동.",
      ].join("\n"),
    });
    state = recordIddStructuredResponse(state, {
      doc: byType.get("spec"),
      provider: "codex",
      responseText: [
        "사용자 workflow는 프로젝트 선택, ICP 카드 입력, 다음 미션 저장 단계.",
        "이번 주 MVP wedge는 가장 작은 Foundation Setup v0.",
        "non-goal은 다중 기기와 완전 자동 문서 생성을 하지 않는 것.",
        "성공 기준은 사용자가 미션 저장 완료를 관찰 가능하게 만드는 것.",
        "핵심 리스크는 실제 인터뷰 증거 없이 가정이 틀리는 실패.",
      ].join("\n"),
    });

    assert.ok(state.ambiguityScore <= IDD_AMBIGUITY_THRESHOLD);
    assert.equal(state.status, "preview_ready");

    const approved = await approveIddSetupDocuments(root, state);
    assert.equal(approved.status, "approved");
  });
});

test("IDD approval rejects complete drafts when ambiguity remains above threshold", async () => {
  await withTempWorkspace(async (root) => {
    const state = {
      drafts: {
        icp: "# ICP\n개발자",
        goal: "# GOAL\n성장",
        values: "# VALUES\n좋은 제품",
        spec: "# SPEC\n앱",
      },
      transcript: [],
    };

    await assert.rejects(
      () => approveIddSetupDocuments(root, state),
      /ambiguity is too high/,
    );
  });
});

test("Day 1 handoff merge preserves existing document content and replaces only managed block", () => {
  const existing = [
    "# GOAL",
    "",
    "기존 목표 섹션",
    "",
    DAY1_HANDOFF_MARKER_START,
    "old generated block",
    DAY1_HANDOFF_MARKER_END,
    "",
    "## Appendix",
    "보존할 링크",
  ].join("\n");
  const merged = mergeDay1HandoffBlock(
    existing,
    [DAY1_HANDOFF_MARKER_START, "new generated block", DAY1_HANDOFF_MARKER_END].join("\n"),
    { title: "GOAL" },
  );

  assert.match(merged, /기존 목표 섹션/);
  assert.match(merged, /new generated block/);
  assert.doesNotMatch(merged, /old generated block/);
  assert.match(merged, /## Appendix\n보존할 링크/);
});

test("Day 1 handoff merge avoids duplicate top-level headings", () => {
  const block = [
    DAY1_HANDOFF_MARKER_START,
    `<!-- generated_by: office-hours; target: ${projectDocPath("goal")}; status: written -->`,
    "",
    "# GOAL",
    "",
    "## 30일 목표",
    "- 첫 고객 반응 검증",
    DAY1_HANDOFF_MARKER_END,
  ].join("\n");

  const emptyMerged = mergeDay1HandoffBlock("", block, { title: "GOAL" });
  assert.equal(countTopLevelHeadings(emptyMerged), 1);
  assert.ok(emptyMerged.startsWith(DAY1_HANDOFF_MARKER_START));

  const titleOnlyMerged = mergeDay1HandoffBlock("# GOAL\n", block, { title: "GOAL" });
  assert.equal(countTopLevelHeadings(titleOnlyMerged), 1);
  assert.ok(titleOnlyMerged.startsWith(DAY1_HANDOFF_MARKER_START));

  const existingMerged = mergeDay1HandoffBlock("# GOAL\n\n기존 목표\n", block, { title: "GOAL" });
  assert.equal(countTopLevelHeadings(existingMerged), 1);
  assert.match(existingMerged, /기존 목표/);
  assert.match(existingMerged, /## 30일 목표/);
});

test("Day 1 handoff writes canonical docs immediately and completes after all four", async () => {
  await withTempWorkspace(async (root) => {
    await fs.writeFile(path.join(root, "docs", "GOAL.md"), "# GOAL\n\n기존 목표\n");
    let state = {};
    const byType = new Map(BIP_REQUIRED_LOCAL_DOCS.map((doc) => [doc.type, doc]));
    state = recordIddStructuredResponse(state, {
      doc: byType.get("goal"),
      provider: "codex",
      responseText: [
        "이번 주 proof target은 첫 인터뷰 카드 완료 3명.",
        "지표는 완료 전환율과 응답 수.",
        "목표값은 3명 완료, 기한은 금요일.",
        "5명에게 연락해 0명이 과거 행동을 말하면 실패하고 피벗.",
      ].join("\n"),
    });
    state = await writeDay1HandoffDocument(root, state, byType.get("goal"), {
      day1Handoff: { goal: "첫 고객 반응 검증", icp: "전업 1인 개발자", pain: "팔 대상이 없음", outcome: "3명 인터뷰" },
    });
    assert.equal(state.docWriteStatuses.goal.status, "written");
    assert.equal(state.status, "interviewing");
    const legacyGoal = await fs.readFile(path.join(root, "docs", "GOAL.md"), "utf8");
    assert.match(legacyGoal, /기존 목표/);
    assert.doesNotMatch(legacyGoal, /agentic30:day1-handoff:start/);

    const canonicalGoal = await fs.readFile(path.join(root, projectDocPath("goal")), "utf8");
    assert.match(canonicalGoal, /agentic30:day1-handoff:start/);
    assert.doesNotMatch(canonicalGoal, /Day 1 Handoff|Document Decision|Rubric Signals/);

    state = recordIddStructuredResponse(state, {
      doc: byType.get("icp"),
      provider: "codex",
      responseText: [
        "유료 고객 0명이고 macOS에서 Codex를 쓰는 전업 1인 개발자.",
        "이번 주 전 직장 동료 A님에게 DM으로 인터뷰 연락 가능.",
        "현재 Notion과 스프레드시트에 인터뷰 메모를 복사해 쓰는 대안.",
        "주 3시간 낭비와 월 20만원 도구비 압박.",
      ].join("\n"),
    });
    state = await writeDay1HandoffDocument(root, state, byType.get("icp"));
    state = recordIddStructuredResponse(state, {
      doc: byType.get("values"),
      provider: "codex",
      responseText: [
        "tradeoff는 넓은 플랫폼 대신 이번 주 검증 행동을 우선 선택.",
        "예쁜 대시보드와 자동화 기능은 포기하고 나중으로 제외.",
        "사용자가 다음 행동을 못 고르는 상황 때 이 원칙을 적용.",
        "위반 예시는 인터뷰 없이 기능을 추가하면 안 된다는 금지 행동.",
      ].join("\n"),
    });
    state = await writeDay1HandoffDocument(root, state, byType.get("values"));
    state = recordIddStructuredResponse(state, {
      doc: byType.get("spec"),
      provider: "codex",
      responseText: [
        "사용자 workflow는 프로젝트 선택, ICP 카드 입력, 다음 미션 저장 단계.",
        "이번 주 MVP wedge는 가장 작은 Foundation Setup v0.",
        "non-goal은 다중 기기와 완전 자동 문서 생성을 하지 않는 것.",
        "성공 기준은 사용자가 미션 저장 완료를 관찰 가능하게 만드는 것.",
        "핵심 리스크는 실제 인터뷰 증거 없이 가정이 틀리는 실패.",
      ].join("\n"),
    });
    state = await writeDay1HandoffDocument(root, state, byType.get("spec"));

    assert.equal(state.status, "approved");
    assert.equal(state.approvedDocPaths.length, 4);
    for (const rel of [projectDocPath("goal"), projectDocPath("icp"), projectDocPath("values"), projectDocPath("spec")]) {
      const content = await fs.readFile(path.join(root, rel), "utf8");
      assert.match(content, /agentic30:day1-handoff:start/);
      assert.match(content, /agentic30:day1-handoff:end/);
      assert.equal(countTopLevelHeadings(content), 1, rel);
    }
  });
});

test("Day 1 bulk handoff writes all canonical docs from final hypothesis", async () => {
  await withTempWorkspace(async (root) => {
    await fs.writeFile(path.join(root, "docs", "GOAL.md"), "# GOAL\n\n기존 목표\n");
    const progress = [];
    const { state } = await writeAllDay1HandoffDocuments(root, {}, {
      provider: "codex",
      day1Handoff: {
        northStarGoal: "첫 고객 반응 검증",
        weeklyProof: "이번 주 3명 인터뷰 완료",
        targetUser: "macOS에서 AI 코딩 도구를 쓰는 전업 1인 개발자",
        problem: "무엇을 팔아야 할지 모른다",
        currentAlternative: "노션과 스프레드시트로 인터뷰 메모를 복사함",
        entryPoint: "첫 인터뷰 카드",
        nextAction: "이번 주 3명 인터뷰 완료",
        nonGoals: ["넓은 고객 후보", "자동화 확장"],
        sourceQuotes: ["노션과 스프레드시트", "이번 주 3명 인터뷰"],
        qualityScore: "9.0/10",
        markdown: "# 핵심 가설",
      },
      onProgress: (event) => progress.push(`${event.doc.type}:${event.stage}`),
    });

    assert.equal(state.status, "approved");
    assert.equal(state.approvedDocPaths.length, 4);
    assert.deepEqual(
      serializeIddSetupFields(state).iddDocPreviews.map((preview) => [preview.type, /^(written|approved)/.test(preview.status)]),
      [
        ["icp", true],
        ["goal", true],
        ["values", true],
        ["spec", true],
      ],
    );
    assert.ok(progress.includes("goal:written"));
    assert.ok(progress.includes("spec:written"));
    for (const rel of [projectDocPath("goal"), projectDocPath("icp"), projectDocPath("values"), projectDocPath("spec")]) {
      const content = await fs.readFile(path.join(root, rel), "utf8");
      assert.match(content, /agentic30:day1-handoff:start/);
      assert.match(content, /agentic30:day1-handoff:end/);
      assert.equal(countTopLevelHeadings(content), 1, rel);
    }
    const legacyGoal = await fs.readFile(path.join(root, "docs", "GOAL.md"), "utf8");
    assert.match(legacyGoal, /기존 목표/);
    assert.doesNotMatch(legacyGoal, /agentic30:day1-handoff:start/);
    const goal = await fs.readFile(path.join(root, projectDocPath("goal")), "utf8");
    assert.match(goal, /첫 고객 반응 검증/);
    assert.doesNotMatch(goal, /Day 1 Handoff|Document Decision|Rubric Signals/);
    assert.doesNotMatch(goal, /이번 주 확인할 행동|검증할 문제|첫 고객 후보/);
    const spec = await fs.readFile(path.join(root, projectDocPath("spec")), "utf8");
    assert.match(spec, /첫 인터뷰 카드/);
    assert.doesNotMatch(spec, /GOAL\/ICP\/VALUES\/SPEC 문서|Foundation|새 AI 실행/);
  });
});

test("Day 1 bulk handoff renders user-facing docs from Office Hours facts without placeholders or app-internal contamination", async () => {
  await withTempWorkspace(async (root) => {
    const { state } = await writeAllDay1HandoffDocuments(root, {}, {
      provider: "claude",
      day1Handoff: {
        northStarGoal: "30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다.",
        weeklyProof: "전용 링크(UTM/코드)로 게시물 1개에서 가입 전환을 추적한다.",
        targetUser: "20대 여성, 불안·우울 관리로 이미 메모·기록 앱을 쓰는 사람",
        problem: "콘텐츠/SNS 유입(릴스·글)이 방문·클릭까지만 보이고 가입으로 이어지는지 모른다.",
        currentAlternative: "운영 중 계정과 유입 증거는 있지만 가입 추적은 분리되어 있다.",
        entryPoint: "전용 링크(UTM/코드)로 게시물 1개→가입 추적",
        nextAction: "가장 절박한 사용자 1명에게 이번 주 유료 진입점을 보여주기",
        nonGoals: ["넓은 고객 후보", "자동화 확장", "여러 고객 유형 확장"],
        assumptions: ["가입 전환 기준값은 아직 확인 필요"],
        sourceQuotes: ["20대 여성", "불안·우울 관리", "메모·기록 앱", "릴스·글", "전용 링크(UTM/코드)", "가입 추적"],
      },
    });

    assert.equal(state.status, "approved");
    assert.ok(
      !state.docWriteStatuses.spec.unresolvedAssumptions.some((item) =>
        /첫 버전에서 하지 않을 일이 필요/.test(item)
      ),
    );

    const icp = await fs.readFile(path.join(root, projectDocPath("icp")), "utf8");
    assert.match(icp, /20대 여성/);
    assert.match(icp, /불안·우울 관리/);
    assert.match(icp, /메모·기록 앱/);
    assert.match(icp, /운영 중 계정과 유입 증거/);
    assert.doesNotMatch(icp, /첫 고객 후보|검증할 문제|이번 주 확인할 행동/);
    assert.doesNotMatch(icp, /기존 동료|DM으로 닿을 수 있는 후보 3명|주 3시간/);

    const spec = await fs.readFile(path.join(root, projectDocPath("spec")), "utf8");
    assert.match(spec, /전용 링크\(UTM\/코드\)/);
    assert.match(spec, /가입 전환을 추적/);
    assert.doesNotMatch(spec, /추적를|보여주기으로/);
    assert.doesNotMatch(spec, /GOAL\/ICP\/VALUES\/SPEC 문서|Day 1|Foundation|새 AI 실행/);
    for (const rel of [projectDocPath("goal"), projectDocPath("icp"), projectDocPath("values"), projectDocPath("spec")]) {
      assert.equal(countTopLevelHeadings(await fs.readFile(path.join(root, rel), "utf8")), 1, rel);
    }

    const values = await fs.readFile(path.join(root, projectDocPath("values")), "utf8");
    assert.match(values, /사용자 행동 증거/);
    assert.doesNotMatch(values, /예쁜 대시보드|다중 Day 확장|플랫폼 확장/);

    const goal = await fs.readFile(path.join(root, projectDocPath("goal")), "utf8");
    assert.match(goal, /30일 안에 핵심 활성 행동을 끝낸 사용자 100명/);
    assert.match(goal, /가입 전환 기준값은 아직 확인 필요/);
  });
});

test("Day 1 handoff quality gate marks incomplete facts with assumptions instead of fabricating evidence", async () => {
  await withTempWorkspace(async (root) => {
    const { state } = await writeAllDay1HandoffDocuments(root, {}, {
      provider: "codex",
      day1Handoff: {
        goal: "30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다.",
        icp: "첫 고객 후보",
        pain: "검증할 문제",
        outcome: "이번 주 확인할 행동",
      },
    });

    assert.equal(state.docWriteStatuses.icp.status, "written_with_assumptions");
    assert.ok(state.docWriteStatuses.icp.unresolvedAssumptions.some((item) => /고객 후보|현재 대안/.test(item)));

    const icp = await fs.readFile(path.join(root, projectDocPath("icp")), "utf8");
    assert.match(icp, /확인 필요/);
    assert.doesNotMatch(icp, /DM으로 닿을 수 있는 후보 3명|주 3시간/);

    const spec = await fs.readFile(path.join(root, projectDocPath("spec")), "utf8");
    assert.doesNotMatch(spec, /GOAL\/ICP\/VALUES\/SPEC 문서|Day 1|Foundation|새 AI 실행/);
  });
});

test("BIP setup gate ignores configured legacy doc paths and requires canonical docs", async () => {
  await withTempWorkspace(async (root) => {
    await fs.writeFile(path.join(root, "docs", "ICP-CUSTOM.md"), "# ICP\n");
    await fs.writeFile(path.join(root, ".agentic30", "docs", "SPEC.md"), "# SPEC\n");
    await fs.writeFile(path.join(root, ".agentic30", "docs", "VALUES.md"), "# VALUES\n");
    await fs.writeFile(path.join(root, ".agentic30", "docs", "DESIGN_SYSTEM.md"), "# DESIGN\n");
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ADR.md"), "# ADR\n");
    await fs.writeFile(path.join(root, ".agentic30", "docs", "GOAL.md"), "# GOAL\n");
    await fs.writeFile(path.join(root, ".agentic30", "docs", "DOCS.md"), "# DOCS\n");
    await fs.writeFile(path.join(root, ".agentic30", "docs", "SHEET.md"), "# SHEET\n");

    const readyGate = getBipSetupGateStatus({
      workspaceRoot: root,
      bipCoachState: { config: { docId: "doc-1", sheetId: "sheet-1" } },
      bipConfig: {
        workspace: {
          icp: "docs/ICP-CUSTOM.md",
        },
      },
    });

    assert.equal(readyGate.ready, false);
    assert.equal(readyGate.missingLocalDocs[0].type, "icp");
    assert.equal(readyGate.missingLocalDocs[0].configuredPath, "docs/ICP-CUSTOM.md");
    assert.equal(readyGate.localDocs.find((doc) => doc.type === "icp").foundPath, null);

    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\n");
    const canonicalGate = getBipSetupGateStatus({
      workspaceRoot: root,
      bipCoachState: { config: { docId: "doc-1", sheetId: "sheet-1" } },
      bipConfig: {
        workspace: {
          icp: "docs/ICP-CUSTOM.md",
        },
      },
    });

    assert.equal(canonicalGate.ready, true);
    assert.equal(canonicalGate.localDocs.find((doc) => doc.type === "icp").foundPath, ".agentic30/docs/ICP.md");

    const staleConfigGate = getBipSetupGateStatus({
      workspaceRoot: root,
      bipCoachState: { config: { docId: "doc-1", sheetId: "sheet-1" } },
      bipConfig: {
        workspace: {
          icp: "docs/MISSING-ICP.md",
        },
      },
    });

    assert.equal(staleConfigGate.ready, true);
    assert.equal(staleConfigGate.localDocs.find((doc) => doc.type === "icp").configuredPath, "docs/MISSING-ICP.md");
    assert.equal(staleConfigGate.localDocs.find((doc) => doc.type === "icp").foundPath, ".agentic30/docs/ICP.md");
  });
});

test("IDD prompt pins provider-specific structured input tool and one-document scope", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "spec");
  const codexPrompt = buildIddDocumentPrompt(doc, { provider: "codex", workspaceRoot: "/workspace" });
  const claudePrompt = buildIddDocumentPrompt(doc, { provider: "claude", workspaceRoot: "/workspace" });

  assert.match(codexPrompt, /agentic30_request_user_input/);
  assert.match(codexPrompt, /request_user_input 카드/);
  assert.doesNotMatch(codexPrompt, /AskUserQuestionTool\(AskUserQuestion\)/);
  assert.match(claudePrompt, /AskUserQuestionTool\(AskUserQuestion\)/);
  assert.match(codexPrompt, /이 세션에서는 이 문서 하나만/);
  assert.match(codexPrompt, /docs\/SPEC\.md/);
});

test("IDD prompt routes choice-based interview questions through plan-style structured input", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  const prompt = buildIddDocumentPrompt(doc, { provider: "codex", workspaceRoot: "/workspace" });

  assert.match(prompt, /\/plan/);
  assert.match(prompt, /UI에서 클릭\/입력/);
  assert.match(prompt, /일반 prose나 번호 목록으로 쓰지 말고 반드시 agentic30_request_user_input/);
  assert.match(prompt, /request_user_input 카드/);
  assert.doesNotMatch(prompt, /structured input unavailable/);
  assert.match(prompt, /같은 질문을 prose\/번호 목록으로 대신 출력하지 말고 중단/);
  assert.match(prompt, /후보군 없이 자유입력만 묻지 마세요/);
  assert.match(prompt, /예전 고정 질문 금지/);
  assert.match(prompt, /첫 질문은 반드시 관찰한 repo 사실/);
  assert.match(prompt, /agentic30-public의 SwiftUI macOS 앱과 Node 실행 보조 앱 구조/);
  assert.match(prompt, /맞춤 인터뷰 규칙/);
  assert.match(prompt, /list_workspace_files, read_workspace_file, search_workspace 중 2개 이상/);
  assert.match(prompt, /README, `\.agentic30\/docs\/\*`, package\/config, 주요 소스, 최근 git 변경/);
  assert.match(prompt, /실제 기능명, 화면, 사용자 흐름/);
  assert.match(prompt, /사용자의 직전 답변을 다음 질문의 입력/);
  assert.match(prompt, /어떤 프로젝트에도 그대로 붙일 수 있는 범용 질문/);
  assert.match(prompt, /Review-grade 질문 규칙/);
  assert.match(prompt, /office-hours 벤치마크/);
  assert.match(prompt, /실제 수요, 현재 대안, 특정 사람, 가장 작은 유료 진입점/);
  assert.match(prompt, /plan-ceo-review 벤치마크/);
  assert.match(prompt, /최소안\/이상안\/대안 관점/);
  assert.match(prompt, /design-review 벤치마크/);
  assert.match(prompt, /I notice/);
  assert.match(prompt, /devex-review 벤치마크/);
  assert.match(prompt, /TTHW\(Time to Hello World\)/);
  assert.match(prompt, /대안\/리스크\/증거\/실패 모드/);
  assert.match(prompt, /어떤 대안이 선택되고 어떤 리스크가 남고 어떤 증거가 문서에 들어가며/);
  assert.match(prompt, /problem\/cause\/fix/);
  assert.match(prompt, /추측하지 말고 증거 출처/);
  assert.match(prompt, /마지막에는 리뷰 체크/);
  assert.match(prompt, /gstack 정렬 매트릭스/);
  assert.match(prompt, /톤: IDD는 친절한 문서화 톤을 유지하되 gstack처럼 직접적이고 증거 중심/);
  assert.match(prompt, /단위: IDD의 기본 단위는 문서 하나가 아니라 질문 하나/);
  assert.match(prompt, /기준: 질문마다 어떤 기준을 검증하는지/);
  assert.match(prompt, /수요 증거, 현재 대안, 작은 유료 진입점, 범위 선택, UX 신뢰, DX 마찰, 운영 리스크, 공개 가능한 실행 증거/);
  assert.match(prompt, /사용 위치: 이 흐름은 구현 리뷰가 아니라 공개 기록 미션 전 문서 점검/);
  assert.match(prompt, /섹션, 결정, 리스크, 다음 공개 글감/);
  assert.match(prompt, /Open Risks/);
  assert.match(prompt, /실패 방지: 빈 문서, 누구에게나 붙는 템플릿 문장, 결정 없는 목록/);
});

test("legacy static IDD fingerprint detector identifies stale ICP structured requests", () => {
  assert.equal(isLegacyStaticIddUserInputRequest({
    title: "ICP 1/4",
    questions: [
      {
        question: "이번 주 바로 인터뷰할 첫 고객은 누구인가요?",
        options: [
          { label: "가장 절박한 하위 ICP", description: "legacy option" },
        ],
      },
    ],
  }), true);

  assert.equal(isLegacyStaticIddUserInputRequest({
    title: "ICP 1/4",
    questions: [
      {
        question: "agentic30-public의 SwiftUI macOS 앱과 Node sidecar 흐름에서 먼저 검증할 사용자는 누구인가요?",
        options: [
          { label: "Codex/Claude 전환 사용자", description: "provider 전환 흐름" },
        ],
      },
    ],
  }), false);
});

test("stale generic host ICP detector catches pre-personalized host questions only", () => {
  assert.equal(isStaleGenericHostIddUserInputRequest({
    generation: { mode: "host_structured", docType: "icp" },
    title: "ICP 1/4",
    questions: [
      {
        question: "이번 주 바로 인터뷰할 첫 고객은 누구인가요?",
        options: [
          { label: "퇴사 후 수익 0원 1인 개발자" },
          { label: "에이전트로 MVP 만든 개발자" },
        ],
      },
    ],
  }), true);

  assert.equal(isStaleGenericHostIddUserInputRequest({
    generation: { mode: "host_structured", docType: "icp" },
    title: "ICP 1/4",
    questions: [
      {
        question: "Agentic30에서 수익 0원 전업 1인 개발자 중 이번 주 바로 인터뷰할 첫 고객은 누구인가요?",
        options: [
          { label: "수익 0원 전업 1인 개발자" },
        ],
      },
    ],
  }), false);
});

test("stale awkward ICP detector catches old literal synthesized copy", () => {
  assert.equal(isStaleAwkwardIcpUserInputRequest({
    generation: { mode: "sidecar_agent_synthesized", docType: "icp" },
    title: "ICP 1/4",
    questions: [
      {
        question: "agentic30 Mac의 첫 인터뷰는 어떤 전업 1인 개발자 세그먼트부터 시작할까요?",
        options: [
          { label: "N번째 제품 실패한 macOS 개발자" },
        ],
      },
    ],
  }), true);

  assert.equal(isStaleAwkwardIcpUserInputRequest({
    generation: { mode: "sidecar_agent_synthesized", docType: "icp" },
    title: "ICP 1/4",
    questions: [
      {
        question: "이번 주 가장 먼저 인터뷰할 1인 개발자 유형은 누구인가요?",
        options: [
          { label: "퇴사 후 첫 매출이 없는 개발자" },
        ],
      },
    ],
  }), false);
});

test("ICP structured input without explainer context is detected for regeneration", () => {
  assert.equal(isMissingIcpContextIntro({
    generation: { mode: "sidecar_agent_synthesized", docType: "icp" },
    title: "ICP 1/4",
    questions: [
      {
        question: "이번 주 가장 먼저 인터뷰할 1인 개발자 유형은 누구인가요?",
        options: [
          { label: "퇴사 후 첫 매출이 없는 개발자" },
        ],
      },
    ],
  }), true);

  const input = initialIddStructuredInputForDoc(
    BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp"),
    { provider: "codex" },
  );
  assert.equal(isMissingIcpContextIntro({
    ...input,
    generation: { mode: "host_structured", docType: "icp" },
  }), false);
});

test("provider_adaptive ICP continuation request is decorated so it does not restart-loop", () => {
  // Mirrors attachIddAdaptiveContinuationToRequest() in sidecar/index.mjs: the
  // continuation path takes a provider-built structured-input request (no intro /
  // resources) and stamps generation.mode = "provider_adaptive". Before the fix it
  // returned that request undecorated, so isMissingIcpContextIntro() flagged it and
  // shouldRestartIddQuestionRequest() restarted it into the same undecorated state.
  const providerRequest = {
    toolName: "agentic30_request_user_input",
    title: "고객 후보 2/4",
    questions: [
      {
        header: "트리거",
        question: "그 고객이 이 문제를 가장 급하게 느끼는 순간은 언제인가요?",
        options: [
          { label: "출시 직후 반응이 없을 때", description: "초기 트래픽이 죽어 있을 때" },
          { label: "환불/이탈이 보일 때", description: "이미 쓰던 사람이 떠날 때" },
        ],
      },
    ],
  };

  // The base request the continuation path builds before decoration.
  const baseRequest = {
    ...providerRequest,
    generation: { mode: "provider_adaptive", docType: "icp" },
  };
  // Latent bug: an undecorated provider_adaptive ICP card is flagged for restart.
  assert.equal(isMissingIcpContextIntro(baseRequest), true);

  // Fix: decorate ICP continuation requests, matching the host_structured and
  // sidecar_agent_synthesized paths.
  const decorated = decorateIcpStructuredInput(baseRequest);
  assert.equal(isMissingIcpContextIntro(decorated), false);

  // Decoration must preserve the provider_adaptive generation metadata and the
  // provider's question so the Mac UI still renders the adaptive card.
  assert.equal(decorated.generation.mode, "provider_adaptive");
  assert.equal(decorated.generation.docType, "icp");
  assert.equal(decorated.questions.length, 1);
  assert.match(decorated.questions[0].question, /가장 급하게 느끼는 순간/);

  // Idempotent: a second decoration keeps the same canonical intro/resources and
  // still passes the gate (decorateIcpStructuredInput is safe to re-apply).
  const reDecorated = decorateIcpStructuredInput(decorated);
  assert.equal(isMissingIcpContextIntro(reDecorated), false);
  assert.equal(reDecorated.intro, decorated.intro);
  assert.deepEqual(
    reDecorated.resources.map((resource) => resource.url),
    decorated.resources.map((resource) => resource.url),
  );

  // A provider that already supplied its own valid resources is left untouched.
  const providerSuppliedResources = decorateIcpStructuredInput({
    ...baseRequest,
    resources: [{ title: "내 글", url: "https://example.com/icp" }],
  });
  assert.deepEqual(
    providerSuppliedResources.resources.map((resource) => resource.url),
    ["https://example.com/icp"],
  );
});

test("IDD adaptive interview rules apply to ICP, VALUES, GOAL, ADR, and DESIGN prompts", () => {
  const docs = ["icp", "values", "goal", "adr", "designSystem"]
    .map((type) => BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === type));

  assert.ok(docs.every(Boolean));

  for (const doc of docs) {
    const prompt = buildIddDocumentPrompt(doc, { provider: "codex", workspaceRoot: "/workspace" });
    assert.match(prompt, /맞춤 인터뷰 규칙/, doc.type);
    assert.match(prompt, /README, docs, package\/config, 주요 소스, 최근 git 변경/, doc.type);
    assert.match(prompt, /매 질문은 관찰한 프로젝트 사실에 연결/, doc.type);
    assert.match(prompt, /어떤 프로젝트에도 그대로 붙일 수 있는 범용 질문/, doc.type);
    assert.match(prompt, new RegExp(doc.canonicalPath.replaceAll("/", "\\/")), doc.type);
  }
});

test("Codex ICP IDD initial input is host-side agentic30_request_user_input with clickable choices", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  const input = initialIddStructuredInputForDoc(doc, {
    provider: "codex",
    onboardingHypothesis: {
      productName: "Agentic30",
      projectKind: "mac_app",
      targetUser: "전업 1인 개발자, 수익 0원, macOS 사용자",
      problem: "만들 줄은 있지만 무엇을 만들어야 팔리는지 모른다",
      purpose: "30일 안에 PMF 검증 방향을 좁힌다",
      likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
      stage: "prototype",
      evidence: ["README: Agentic30"],
      confidence: "high",
      suggestedFirstQuestion: "",
    },
  });

  assert.equal(input.toolName, "agentic30_request_user_input");
  assert.equal(input.title, "Ideal Customer Profile 1/4");
  assert.equal(input.intro?.title || "", "Ideal Customer Profile");
  assert.match(input.intro?.body || "", /이번 주 실제로 연락하고 인터뷰/);
  assert.ok(input.intro?.bullets?.some((bullet) => bullet.includes("현재 대안")));
  assert.deepEqual(
    input.resources?.map((resource) => resource.url),
    [
      "https://posthog.com/newsletter/ideal-customer-profile-framework",
      "https://posthog.com/founders/creating-ideal-customer-profile",
      "https://newsletter.posthog.com/p/defining-our-icp-is-the-most-important",
    ],
  );
  assert.equal(input.questions.length, 1);
  assert.equal(input.questions[0].allowFreeText, true);
  assert.equal(input.questions[0].textMode, "short");
  assert.match(input.questions[0].helperText, /팔릴 방향을 못 잡고/);
  assert.match(input.questions[0].question, /가장 먼저 인터뷰할 1인 개발자 유형/);
  assert.deepEqual(
    input.questions[0].options.map((option) => option.label),
    ["퇴사 후 첫 매출이 없는 개발자", "AI로 제품은 만들었지만 고객이 없는 개발자", "여러 번 출시했지만 반응이 약했던 개발자"],
  );
  assert.match(input.questions[0].options[0].description, /팔 대상과 첫 고객 증거/);
  assert.match(input.questions[0].options[1].description, /Codex\/Claude/);
  assert.match(input.questions[0].options[2].description, /반복 실패/);
  assert.equal(initialIddStructuredInputForDoc(doc, { provider: "claude" }), null);
});

test("Codex non-ICP IDD initial input is host-side to avoid provider tool fallback", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "sheet");
  const input = initialIddStructuredInputForDoc(doc, { provider: "codex" });

  assert.equal(input.toolName, "agentic30_request_user_input");
  assert.equal(input.title, "공개 기록 기준 정하기");
  assert.equal(input.questions.length, 1);
  assert.equal(input.questions[0].allowFreeText, true);
  assert.equal(input.questions[0].textMode, "short");
  assert.equal(input.questions[0].header, "한 가지 선택");
  assert.match(input.questions[0].helperText, new RegExp(projectDocPath("sheet").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(input.questions[0].helperText, /공개 글의 기록 열/);
  assert.match(input.questions[0].helperText, new RegExp(`저장: ${projectDocPath("sheet").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(input.questions[0].question, /공개 기록 기준에서 이번 주 먼저 고정할 기준/);
  assert.doesNotMatch(`${input.title}\n${input.questions[0].helperText}\n${input.questions[0].question}`, /IDD|BIP/);
  assert.deepEqual(
    input.questions[0].options.map((option) => option.nextIntent),
    [
      "document_current_workflow",
      "document_nearest_action",
      "document_failure_modes",
      "document_unknown",
    ],
  );
});

test("Codex GOAL IDD initial input asks for the goal before proof target", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "goal");
  const input = initialIddStructuredInputForDoc(doc, { provider: "codex" });
  const question = input.questions[0];

  assert.equal(input.toolName, "agentic30_request_user_input");
  assert.equal(input.title, "목표 정하기");
  assert.equal(question.header, "이번 주 목표");
  assert.match(question.helperText, /검증 기준, 지표, 실패 조건은 다음 카드/);
  assert.match(question.question, /가장 먼저 검증하거나 달성하려는 목표/);
  assert.equal(question.requiresFreeText, false);
  assert.deepEqual(
    question.options.map((option) => option.label),
    ["첫 고객 반응 확인", "문제 강도 확인", "가장 작은 해결책 확인"],
  );

  const state = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "첫 고객 반응",
  });
  const followup = buildIddFollowupStructuredInputForDoc(doc, state);

  assert.match(followup.questions[0].question, /방금 정한 GOAL/);
  assert.deepEqual(
    followup.questions[0].options.map((option) => option.label),
    ["문제 증거", "수요 증거", "사용 행동 증거"],
  );
  assert.doesNotMatch(
    followup.questions[0].options.map((option) => option.label).join("\n"),
    /범위 증명/,
  );
});

test("Codex design-system initial input shows concrete visual examples", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "designSystem");
  const input = initialIddStructuredInputForDoc(doc, { provider: "codex" });
  const question = input.questions[0];
  const descriptions = question.options.map((option) => option.description).join("\n");
  const prompt = buildIddDocumentPrompt(doc, { provider: "codex", workspaceRoot: "/workspace" });

  assert.equal(input.title, "화면 원칙 정하기");
  assert.match(question.question, /화면 원칙에서 이번 주 먼저 고정할 기준/);
  assert.match(descriptions, /\[상단: 오늘 할 일\] -> \[본문: 질문\] -> \[하단: 다음 행동\]/);
  assert.match(descriptions, /\[질문\]  \[선택 A\] \[선택 B\] \[기타 입력\]/);
  assert.match(descriptions, /A: 업무형  B: 카드형  C: 대화형/);
  assert.match(prompt, /design-shotgun/);
  assert.match(prompt, /ASCII ART 와이어프레임/);
});

test("Codex ICP IDD initial input has a low-confidence fallback that does not require expertise", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  const input = initialIddStructuredInputForDoc(doc, { provider: "codex" });

  assert.match(input.intro?.title || "", /Ideal Customer Profile/);
  assert.equal(input.resources?.length, 3);
  assert.match(input.questions[0].question, /가장 먼저 인터뷰할 고객 유형/);
  assert.equal(input.questions[0].helperText, "먼저 첫 고객 후보 하나만 고릅니다.");
  assert.deepEqual(
    input.questions[0].options.map((option) => option.label),
    ["나 또는 우리 팀 중 지금 막힌 사람", "이 제품 대안을 이미 쓰는 사람", "돈이나 시간을 이미 쓰는 사람"],
  );
});

test("Codex ICP IDD initial input uses natural medium-confidence Korean", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  const input = initialIddStructuredInputForDoc(doc, {
    provider: "codex",
    onboardingHypothesis: {
      projectKind: "unknown",
      likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
      stage: "prototype",
      evidence: ["README: Agentic30"],
      confidence: "medium",
    },
  });

  assert.match(input.questions[0].helperText, /대상: AI 코딩 도구를 쓰는 개발자/);
  assert.match(input.questions[0].question, /먼저 만날 AI 코딩 도구를 쓰는 개발자 유형/);
  assert.doesNotMatch(input.questions[0].question, /단서가 보여요/);
});

test("IDD continuation prompt carries structured response and prevents repeating the previous question", () => {
  const prompt = buildIddContinuationPrompt({
    iddPrompt: "IDD 문서 인터뷰를 시작합니다: ICP",
    structuredResponseText: "반복 사용 — B2B SaaS 창업팀",
  });

  assert.match(prompt, /직전 구조화 답변/);
  assert.match(prompt, /반복 사용 — B2B SaaS 창업팀/);
  assert.match(prompt, /방금 답한 질문이나 같은 선택지 라벨을 반복하지 마세요/);
  assert.match(prompt, /현재 프로젝트의 실제 맥락에 맞춰 맞춤 인터뷰/);
  assert.match(prompt, /README, docs, package\/config, 주요 소스, 최근 git 변경/);
  assert.match(prompt, /범용 질문이나 템플릿 질문/);
  assert.match(prompt, /decision brief/);
  assert.match(prompt, /제품 이름, 대상 유저, 해결 문제, 제품 목적/);
  assert.match(prompt, /office-hours 방식/);
  assert.match(prompt, /plan-ceo-review 방식/);
  assert.match(prompt, /design-review 방식/);
  assert.match(prompt, /devex-review 방식/);
  assert.match(prompt, /Time to Hello World/);
  assert.match(prompt, /gstack 정렬 축/);
  assert.match(prompt, /톤은 직접적이고 증거 중심/);
  assert.match(prompt, /한 질문=한 결정/);
  assert.match(prompt, /수요\/범위\/UX\/DX\/리스크/);
  assert.match(prompt, /공개 기록 문서 완성 직전의 기준/);
  assert.match(prompt, /범용 문서\/빈 결정\/조용한 누락 차단/);
  assert.match(prompt, /대안\/리스크\/증거\/실패 모드/);
  assert.match(prompt, /어떤 근거가 있는지/);
  assert.match(prompt, /어떤 문서 실패가 생기는지/);
  assert.match(prompt, /대상 문서의 섹션, 결정, Open Risks, 다음 공개 기록 글감/);
  assert.match(prompt, /agentic30_request_user_input 도구 연결/);
  assert.match(prompt, /request_user_input 카드/);
  assert.match(prompt, /2-4개 후보 options/);
  assert.doesNotMatch(prompt, /requiresFreeText: true/);
  assert.match(prompt, /선택지 또는 기타 자유 입력/);
  assert.doesNotMatch(prompt, /structured input unavailable/);
});

test("IDD document prompt embeds gstack pushback patterns, anti-sycophancy, and 5-point closing review", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  const prompt = buildIddDocumentPrompt(doc, { provider: "codex", workspaceRoot: "/workspace" });

  assert.match(prompt, /Pushback 표준 응답/);
  assert.match(prompt, /모호한 시장 → 구체성 강제/);
  assert.match(prompt, /사회적 증거 → 수요 검증/);
  assert.match(prompt, /플랫폼 비전 → 작은 유료 진입점 도전/);
  assert.match(prompt, /성장률 통계 → 비전 검증/);
  assert.match(prompt, /정의되지 않은 용어 → 정밀도 요구/);
  assert.match(prompt, /사랑은 수요가 아닙니다/);

  assert.match(prompt, /Anti-Sycophancy 규칙/);
  assert.match(prompt, /흥미로운 접근이에요/);
  assert.match(prompt, /이 가정은 미확인이에요/);

  assert.match(prompt, /마무리 리뷰 체크/);
  assert.match(prompt, /남은 모순/);
  assert.match(prompt, /가장 위험한 가정/);
  assert.match(prompt, /다음 공개 기록 미션에서 공개해도 되는 한 문장/);
  assert.match(prompt, /이번 주 단 하나의 구체 행동/);
});

test("IDD continuation prompt embeds short-form pushback and anti-sycophancy reminders", () => {
  const prompt = buildIddContinuationPrompt({
    iddPrompt: "IDD 문서 인터뷰를 시작합니다: ICP",
    structuredResponseText: "반복 사용 — B2B SaaS 창업팀",
  });

  assert.match(prompt, /Pushback 즉시 적용/);
  assert.match(prompt, /집합명사/);
  assert.match(prompt, /사랑은 수요가 아닙니다/);
  assert.match(prompt, /Anti-Sycophancy/);
  assert.match(prompt, /흥미로운 접근이에요/);
  assert.match(prompt, /근거가 부족해요/);
});

// F1: agent post-validation — reject drift, accept on-topic synthesis.
test("agentSynthesisTargetsCorrectSignal rejects questions that drift off the expected rubric signal", () => {
  // narrow_segment expected, but question only talks about reachability → reject.
  assert.equal(
    agentSynthesisTargetsCorrectSignal({
      question: "이번 주 DM 가능한 @handle은 누구인가요?",
      options: [
        { label: "이미 아는 사람", description: "이름이나 관계가 있어 바로 연락 가능합니다." },
      ],
      expectedSignalId: "narrow_segment",
    }),
    false,
  );

  // reachable_person expected and question matches → accept.
  assert.equal(
    agentSynthesisTargetsCorrectSignal({
      question: "이번 주 직접 만날 사람은 누구인가요?",
      options: [
        { label: "전 직장 동료", description: "DM으로 인터뷰 연락 가능합니다." },
      ],
      expectedSignalId: "reachable_person",
    }),
    true,
  );

  // current_alternative expected and option text carries the keyword → accept.
  assert.equal(
    agentSynthesisTargetsCorrectSignal({
      question: "이 사람은 지금 어떻게 일을 처리하나요?",
      options: [
        { label: "기존의 방식 그대로", description: "Notion에 메모를 복사해 씁니다." },
      ],
      expectedSignalId: "current_alternative",
    }),
    true,
  );

  // unknown signal id → conservative pass.
  assert.equal(
    agentSynthesisTargetsCorrectSignal({
      question: "임의의 질문",
      options: [],
      expectedSignalId: "totally_made_up_signal",
    }),
    true,
  );

  // no expected signal id → pass through.
  assert.equal(agentSynthesisTargetsCorrectSignal({ question: "임의의 질문" }), true);
});

// F4: dedupe helpers — semantic duplicates collapse, distinct options stay.
test("dedupeIddAgentOptions drops semantic duplicates and preserves distinct options", () => {
  const collapsed = dedupeIddAgentOptions([
    { label: "AI로 MVP만 만든 개발자", description: "AI 코딩 도구로 첫 prototype은 끝냈지만 고객이 없는 개발자" },
    { label: "AI로 제품은 만들었지만 고객이 없는 개발자", description: "AI 코딩 도구로 MVP는 만들었지만 유료 고객이 없는 개발자" },
  ]);
  assert.equal(collapsed.length, 1);

  const preserved = dedupeIddAgentOptions([
    { label: "시간 비용", description: "주당 낭비 시간을 적습니다." },
    { label: "돈 비용", description: "도구비, 외주비, 놓친 매출을 적습니다." },
    { label: "기회 비용", description: "출시 지연, 공개 실패, 신뢰 하락을 적습니다." },
  ]);
  assert.equal(preserved.length, 3);

  // Safe with empty/null entries.
  assert.deepEqual(
    dedupeIddAgentOptions([null, undefined, { label: "유효한 항목", description: "유효한 설명" }]),
    [null, undefined, { label: "유효한 항목", description: "유효한 설명" }],
  );

  // After Korean stop-suffix stripping, "개발자" reduces away — what survives
  // is description content. Two options with semantically distinct descriptions
  // should not collapse just because both labels start with "개발자".
  const distinct = dedupeIddAgentOptions([
    { label: "개발자 A", description: "macOS Codex 환경" },
    { label: "개발자 B", description: "Windows Claude 환경" },
  ]);
  assert.equal(distinct.length, 2);
});

test("iddOptionContentTokens strips Korean stop suffixes and short noise", () => {
  const tokens = iddOptionContentTokens("AI로 만든 MVP만 발표한 개발자");
  // suffix-stripped, lowercased; ≥2 chars
  assert.ok(tokens.has("ai") || tokens.has("mvp"));
  // bare "개발자" should become empty after suffix strip → filtered
  assert.equal(tokens.has("개발자"), false);
});

test("iddOptionTokenJaccard returns 0 when either side is empty", () => {
  assert.equal(iddOptionTokenJaccard(new Set(), new Set(["a"])), 0);
  assert.equal(iddOptionTokenJaccard(new Set(["a"]), new Set()), 0);
});

// F2/F6: follow-up generation stamps for last-signal + dimension transition.
test("ICP follow-up stamps isLastSignalForDoc and dimensionTransitioned for the next card", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  // First answer: concrete narrow segment, intentionally digit-free so the
  // shared rubric text does not accidentally auto-pass pressure_cost via the
  // hasNumber branch.
  const after1 = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "유료 고객이 없는 macOS Codex 사용자인 전업 솔로 개발자",
    signalId: "narrow_segment",
    signalLabel: "좁히기",
  });
  const input1 = buildIddFollowupStructuredInputForDoc(doc, after1);
  // After one ICP card, we should now be on reachable_person (next missing
  // signal), with a dimension transition flag stamped.
  assert.equal(input1.generation?.signalId, "reachable_person");
  assert.equal(input1.generation?.dimensionTransitioned, true);
  assert.equal(input1.generation?.previousSignalLabel, "좁히기");
  assert.equal(input1.generation?.isLastSignalForDoc, false);

  // Provide reachable_person + current_alternative content so only
  // pressure_cost remains — that card must report isLastSignalForDoc=true.
  let stepped = after1;
  stepped = recordIddStructuredResponse(stepped, {
    doc,
    provider: "codex",
    responseText: "이번 주 전 직장 동료 A님에게 DM으로 인터뷰 연락 가능합니다.",
    signalId: "reachable_person",
    signalLabel: "직접 만날 사람",
  });
  stepped = recordIddStructuredResponse(stepped, {
    doc,
    provider: "codex",
    responseText: "현재 Notion과 스프레드시트에 인터뷰 메모를 복사해 쓰는 대안.",
    signalId: "current_alternative",
    signalLabel: "기존의 방식",
  });
  const inputLast = buildIddFollowupStructuredInputForDoc(doc, stepped);
  assert.equal(inputLast.generation?.signalId, "pressure_cost");
  assert.equal(inputLast.generation?.signalLabel, "고통과 시급성");
  assert.equal(inputLast.title, "Ideal Customer Profile · 고통과 시급성");
  assert.equal(inputLast.generation?.isLastSignalForDoc, true);
  assert.equal(inputLast.generation?.dimensionTransitioned, true);
  assert.equal(inputLast.generation?.previousSignalLabel, "기존의 방식");
});

// F7: generic-noun guard — bare "개발자" repeats must NOT auto-pass narrow_segment.
test("autoPassSignalsFromRepeatedAnswers keeps narrow_segment missing when every ICP answer is a generic noun", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  let state = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "개발자",
  });
  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "개발자",
  });
  const icpRubric = state.ambiguityRubric.docs.find((entry) => entry.type === "icp");
  assert.equal(
    icpRubric.missingSignals[0]?.id,
    "narrow_segment",
    "two bare 개발자 answers must keep narrow_segment alive (no auto-pass)",
  );
});

test("autoPassSignalsFromRepeatedAnswers auto-passes when at least one answer is concrete", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  let state = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "개발자",
  });
  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "출시 후 반응 약한 1인 개발자",
  });
  const icpRubric = state.ambiguityRubric.docs.find((entry) => entry.type === "icp");
  assert.ok(
    icpRubric.passedSignals.some((signal) => signal.id === "narrow_segment"),
    "concrete answer alongside generic noun should still auto-pass narrow_segment",
  );
});

// Reproduces the Day 1 ICP card "2/4 · 직접 만날 사람" stuck-counter bug.
// Sidecar-synthesized option labels rarely include the reachable_person
// keyword set (이름/연락/dm/만날/계정/...), so signalPasses keeps failing and
// the host re-asks the same dimension forever. The repeated-answer guard now
// covers reachable_person/current_alternative/pressure_cost so a second click
// on the same signal advances the rubric.
test("ICP reachable_person auto-passes after 2 same-signal answers that miss the keyword regex", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  let state = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "퇴사 후 첫 결제 없는 솔로 풀타임 개발자",
    signalId: "narrow_segment",
    signalLabel: "좁히기",
  });
  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "Threads에 빌드 기록 중인 개발자",
    signalId: "reachable_person",
    signalLabel: "직접 만날 사람",
  });
  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "내 글에 반응한 개발자",
    signalId: "reachable_person",
    signalLabel: "직접 만날 사람",
  });
  const icpRubric = state.ambiguityRubric.docs.find((entry) => entry.type === "icp");
  assert.ok(
    icpRubric.passedSignals.some((signal) => signal.id === "reachable_person"),
    "two reachable_person clicks lacking keyword should still advance the loop",
  );
  const followup = buildIddFollowupStructuredInputForDoc(doc, state);
  assert.notEqual(
    followup.generation?.signalId,
    "reachable_person",
    "follow-up must advance off reachable_person to the next missing signal",
  );
});

test("ICP reachable_person stays missing on a single same-signal answer", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  const state = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "Threads에 빌드 기록 중인 개발자",
    signalId: "reachable_person",
    signalLabel: "직접 만날 사람",
  });
  const icpRubric = state.ambiguityRubric.docs.find((entry) => entry.type === "icp");
  assert.ok(
    icpRubric.missingSignals.some((signal) => signal.id === "reachable_person"),
    "one answer without keyword match must not auto-pass reachable_person",
  );
});

test("ICP reachable_person stays missing when every same-signal answer is a bare generic noun", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  let state = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "개발자",
    signalId: "reachable_person",
    signalLabel: "직접 만날 사람",
  });
  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "사용자",
    signalId: "reachable_person",
    signalLabel: "직접 만날 사람",
  });
  const icpRubric = state.ambiguityRubric.docs.find((entry) => entry.type === "icp");
  assert.ok(
    icpRubric.missingSignals.some((signal) => signal.id === "reachable_person"),
    "two bare generic answers must keep reachable_person missing (no auto-pass)",
  );
});

// The synthesized option list almost always packs the rubric keywords into
// description, not label. Without this signal, every ICP follow-up signal
// gets asked twice before the repeated-answer fallback fires.
test("ICP reachable_person passes on a single click when the description carries the keyword", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  let state = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "퇴사 후 첫 결제 없는 솔로 풀타임 개발자",
    signalId: "narrow_segment",
    signalLabel: "좁히기",
  });
  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "Threads에 빌드 기록 중인 개발자",
    responseDescription: "최근 게시글과 계정이 보여 관찰 후 DM으로 인터뷰를 요청하기 쉽습니다.",
    signalId: "reachable_person",
    signalLabel: "직접 만날 사람",
  });
  const icpRubric = state.ambiguityRubric.docs.find((entry) => entry.type === "icp");
  assert.ok(
    icpRubric.passedSignals.some((signal) => signal.id === "reachable_person"),
    "single click with keyword-bearing description should advance reachable_person without the repeated-answer fallback",
  );
});

test("ICP reachable_person stays missing on a single click when neither label nor description carries the keyword", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  let state = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "퇴사 후 첫 결제 없는 솔로 풀타임 개발자",
    signalId: "narrow_segment",
    signalLabel: "좁히기",
  });
  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "Threads에 빌드 기록 중인 개발자",
    responseDescription: "최근 빌드 기록이 보이는 사람",
    signalId: "reachable_person",
    signalLabel: "직접 만날 사람",
  });
  const icpRubric = state.ambiguityRubric.docs.find((entry) => entry.type === "icp");
  assert.ok(
    icpRubric.missingSignals.some((signal) => signal.id === "reachable_person"),
    "without keyword in label or description, a single click must not advance reachable_person — repeated-answer fallback must still kick in on the next click",
  );
});

test("ICP current_alternative and pressure_cost share the repeated-answer auto-pass", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  let state = recordIddStructuredResponse({}, {
    doc,
    provider: "codex",
    responseText: "퇴사 후 첫 결제 없는 솔로 풀타임 개발자",
    signalId: "narrow_segment",
    signalLabel: "좁히기",
  });
  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "Threads에 빌드 기록 중인 개발자",
    signalId: "reachable_person",
    signalLabel: "직접 만날 사람",
  });
  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "내 글에 반응한 개발자",
    signalId: "reachable_person",
    signalLabel: "직접 만날 사람",
  });
  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "그냥 머리로만 정리하는 사람",
    signalId: "current_alternative",
    signalLabel: "기존의 방식",
  });
  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "수첩에 손으로 적는 사람",
    signalId: "current_alternative",
    signalLabel: "기존의 방식",
  });
  let icpRubric = state.ambiguityRubric.docs.find((entry) => entry.type === "icp");
  assert.ok(
    icpRubric.passedSignals.some((signal) => signal.id === "current_alternative"),
    "two current_alternative clicks lacking keyword should advance the loop",
  );

  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "이대로 가면 끝장이라 느끼는 사람",
    signalId: "pressure_cost",
    signalLabel: "고통과 시급성",
  });
  state = recordIddStructuredResponse(state, {
    doc,
    provider: "codex",
    responseText: "그만두고 싶을 만큼 답답한 사람",
    signalId: "pressure_cost",
    signalLabel: "고통과 시급성",
  });
  icpRubric = state.ambiguityRubric.docs.find((entry) => entry.type === "icp");
  assert.ok(
    icpRubric.passedSignals.some((signal) => signal.id === "pressure_cost"),
    "two pressure_cost clicks lacking keyword/digits should advance the loop",
  );
});

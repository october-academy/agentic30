import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  BIP_REQUIRED_LOCAL_DOCS,
  IDD_AMBIGUITY_THRESHOLD,
  approveIddSetupDocuments,
  buildIddFollowupStructuredInputForDoc,
  buildIddContinuationPrompt,
  buildIddDocumentPrompt,
  calculateIddAmbiguityRubric,
  deriveLocalDocReadinessRows,
  docTypeFromLocalRowId,
  getBipSetupGateStatus,
  initialIddStructuredInputForDoc,
  isLegacyStaticIddUserInputRequest,
  isMissingIcpContextIntro,
  isStaleAwkwardIcpUserInputRequest,
  isStaleGenericHostIddUserInputRequest,
  localDocRowId,
  recordIddStructuredResponse,
  serializeIddSetupFields,
  setIddSetupError,
} from "../sidecar/idd-doc-gate.mjs";

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-gate-"));
  try {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("BIP setup gate requires all local docs and Google links", async () => {
  await withTempWorkspace(async (root) => {
    await fs.writeFile(path.join(root, "docs", "ICP.md"), "# ICP\n");

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

test("BIP setup gate passes with accepted aliases and external links", async () => {
  await withTempWorkspace(async (root) => {
    const files = [
      "docs/ICP.md",
      "docs/SPEC.md",
      "docs/VALUES.md",
      "docs/DESIGN.md",
      "docs/ADR.md",
      "docs/GOAL.md",
      "docs/DOCS.md",
      "docs/SHEET.md",
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
  assert.equal(input.title, "ICP 모호함 낮추기");
  assert.match(input.questions[0].helperText, /Ambiguity/);
  assert.match(input.questions[0].question, /연락하거나 관찰/);
  assert.equal(input.questions[0].allowFreeText, true);
  assert.equal(input.questions[0].requiresFreeText, false);
});

test("VALUES follow-up questions ask for decisions instead of fallback evidence format", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "values");
  const cases = [
    {
      signalId: "tradeoff",
      responseText: "고객 인터뷰 기록",
      questionPattern: /실제로 포기할 선택/,
      optionPattern: /고객 인터뷰 기록/,
    },
    {
      signalId: "rejected_option",
      responseText: "속도보다 증거를 우선한다.",
      questionPattern: /거절해야 하는 요청/,
      optionPattern: /속도|증거/,
    },
    {
      signalId: "trigger",
      responseText: "속도보다 증거를 우선하고 새 기능은 하지 않는다.",
      questionPattern: /어떤 순간에 바로 적용/,
      optionPattern: /속도|증거/,
    },
    {
      signalId: "violation_example",
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

    assert.equal(input.title, "VALUES 모호함 낮추기");
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

  assert.equal(goal.title, "GOAL 정하기");
  assert.match(goal.questions[0].question, /GOAL/);
  assert.match(goal.questions[0].helperText, /proof target|목표/);
  assert.equal(goal.questions[0].requiresFreeText, false);

  assert.equal(values.title, "VALUES 정하기");
  assert.match(values.questions[0].question, /tradeoff|거절 기준/);
  assert.match(values.questions[0].freeTextPlaceholder, /신뢰/);
  assert.equal(values.questions[0].requiresFreeText, false);

  assert.equal(spec.title, "SPEC 정하기");
  assert.match(spec.questions[0].question, /핵심 workflow/);
  assert.match(spec.questions[0].freeTextPlaceholder, /Day 1 미션/);
  assert.equal(spec.questions[0].requiresFreeText, false);
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

test("BIP setup gate honors configured doc paths only when files exist", async () => {
  await withTempWorkspace(async (root) => {
    await fs.writeFile(path.join(root, "docs", "ICP-CUSTOM.md"), "# ICP\n");
    await fs.writeFile(path.join(root, "docs", "SPEC.md"), "# SPEC\n");
    await fs.writeFile(path.join(root, "docs", "VALUES.md"), "# VALUES\n");
    await fs.writeFile(path.join(root, "docs", "DESIGN.md"), "# DESIGN\n");
    await fs.writeFile(path.join(root, "docs", "ADR.md"), "# ADR\n");
    await fs.writeFile(path.join(root, "docs", "GOAL.md"), "# GOAL\n");
    await fs.writeFile(path.join(root, "docs", "DOCS.md"), "# DOCS\n");
    await fs.writeFile(path.join(root, "docs", "SHEET.md"), "# SHEET\n");

    const readyGate = getBipSetupGateStatus({
      workspaceRoot: root,
      bipCoachState: { config: { docId: "doc-1", sheetId: "sheet-1" } },
      bipConfig: {
        workspace: {
          icp: "docs/ICP-CUSTOM.md",
        },
      },
    });

    assert.equal(readyGate.ready, true);
    assert.equal(readyGate.localDocs.find((doc) => doc.type === "icp").foundPath, "docs/ICP-CUSTOM.md");

    const staleGate = getBipSetupGateStatus({
      workspaceRoot: root,
      bipCoachState: { config: { docId: "doc-1", sheetId: "sheet-1" } },
      bipConfig: {
        workspace: {
          icp: "docs/MISSING-ICP.md",
        },
      },
    });

    assert.equal(staleGate.ready, false);
    assert.equal(staleGate.missingLocalDocs[0].type, "icp");
    assert.equal(staleGate.missingLocalDocs[0].configuredPath, "docs/MISSING-ICP.md");
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
  assert.match(prompt, /legacy static 질문 금지/);
  assert.match(prompt, /첫 질문은 반드시 관찰한 repo 사실/);
  assert.match(prompt, /agentic30-public의 SwiftUI macOS 앱과 Node sidecar 구조/);
  assert.match(prompt, /Adaptive\/Personalized 인터뷰 규칙/);
  assert.match(prompt, /list_workspace_files, read_workspace_file, search_workspace 중 2개 이상/);
  assert.match(prompt, /README, docs, package\/config, 주요 소스, 최근 git 변경/);
  assert.match(prompt, /실제 기능명, 화면, 사용자 흐름/);
  assert.match(prompt, /사용자의 직전 답변을 다음 질문의 입력/);
  assert.match(prompt, /어떤 프로젝트에도 그대로 붙일 수 있는 범용 질문/);
  assert.match(prompt, /Review-grade 질문 규칙/);
  assert.match(prompt, /office-hours 벤치마크/);
  assert.match(prompt, /실제 수요, 현재 대안, 특정 사람, 가장 작은 wedge/);
  assert.match(prompt, /plan-ceo-review 벤치마크/);
  assert.match(prompt, /최소안\/이상안\/대안 관점/);
  assert.match(prompt, /design-review 벤치마크/);
  assert.match(prompt, /I notice/);
  assert.match(prompt, /devex-review 벤치마크/);
  assert.match(prompt, /TTHW\(Time to Hello World\)/);
  assert.match(prompt, /대안\/리스크\/증거\/실패 모드/);
  assert.match(prompt, /어떤 대안이 선택되고, 어떤 리스크가 남고, 어떤 증거가 문서에 들어가며/);
  assert.match(prompt, /problem\/cause\/fix/);
  assert.match(prompt, /추측하지 말고 증거 출처/);
  assert.match(prompt, /마지막에는 리뷰 체크/);
  assert.match(prompt, /gstack 정렬 매트릭스/);
  assert.match(prompt, /톤: IDD는 친절한 문서화 톤을 유지하되 gstack처럼 직접적이고 증거 중심/);
  assert.match(prompt, /단위: IDD의 기본 단위는 문서 하나가 아니라 질문 하나/);
  assert.match(prompt, /기준: 질문마다 어떤 기준을 검증하는지/);
  assert.match(prompt, /수요 증거, 현재 대안, 좁은 wedge, 범위 선택, UX 신뢰, DX 마찰, 운영 리스크, 공개 가능한 BIP 증거/);
  assert.match(prompt, /사용 위치: 이 플로우는 구현 리뷰가 아니라 BIP 미션 전 문서 게이트/);
  assert.match(prompt, /문서의 섹션, 결정, 리스크, 다음 BIP 공개 글감/);
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

test("IDD adaptive interview rules apply to ICP, VALUES, GOAL, ADR, and DESIGN prompts", () => {
  const docs = ["icp", "values", "goal", "adr", "designSystem"]
    .map((type) => BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === type));

  assert.ok(docs.every(Boolean));

  for (const doc of docs) {
    const prompt = buildIddDocumentPrompt(doc, { provider: "codex", workspaceRoot: "/workspace" });
    assert.match(prompt, /Adaptive\/Personalized 인터뷰 규칙/, doc.type);
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
  assert.equal(input.title, "ICP 1/4");
  assert.match(input.intro?.title || "", /ICP \(Ideal Customer Profile\)/);
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
  assert.match(input.questions[0].helperText, /docs\/SHEET\.md/);
  assert.match(input.questions[0].helperText, /공개 글의 기록 열/);
  assert.match(input.questions[0].helperText, /저장: docs\/SHEET\.md/);
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
  assert.equal(input.title, "GOAL 정하기");
  assert.equal(question.header, "이번 주 GOAL");
  assert.match(question.helperText, /proof target, 지표, 실패 조건은 다음 카드/);
  assert.match(question.question, /가장 먼저 검증하거나 달성하려는 GOAL/);
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
  assert.match(prompt, /현재 프로젝트의 실제 맥락에 맞춰 Adaptive\/Personalized 인터뷰/);
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
  assert.match(prompt, /BIP 문서 완성 직전의 게이트/);
  assert.match(prompt, /범용 문서\/빈 결정\/조용한 누락 차단/);
  assert.match(prompt, /대안\/리스크\/증거\/실패 모드/);
  assert.match(prompt, /어떤 근거가 있는지/);
  assert.match(prompt, /어떤 문서 실패가 생기는지/);
  assert.match(prompt, /대상 문서의 섹션, 결정, Open Risks, 다음 BIP 공개 글감/);
  assert.match(prompt, /agentic30_request_user_input MCP 도구/);
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
  assert.match(prompt, /플랫폼 비전 → 웨지 도전/);
  assert.match(prompt, /성장률 통계 → 비전 검증/);
  assert.match(prompt, /정의되지 않은 용어 → 정밀도 요구/);
  assert.match(prompt, /사랑은 수요가 아닙니다/);

  assert.match(prompt, /Anti-Sycophancy 규칙/);
  assert.match(prompt, /흥미로운 접근이에요/);
  assert.match(prompt, /이 가정은 미확인이에요/);

  assert.match(prompt, /마무리 리뷰 체크/);
  assert.match(prompt, /남은 모순/);
  assert.match(prompt, /가장 위험한 가정/);
  assert.match(prompt, /다음 BIP 공개 글감 한 문장/);
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

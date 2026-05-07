import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  BIP_REQUIRED_LOCAL_DOCS,
  buildIddContinuationPrompt,
  buildIddDocumentPrompt,
  deriveLocalDocReadinessRows,
  docTypeFromLocalRowId,
  getBipSetupGateStatus,
  initialIddStructuredInputForDoc,
  localDocRowId,
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
  assert.doesNotMatch(codexPrompt, /(^|[^A-Za-z0-9_])request_user_input([^A-Za-z0-9_]|$)/);
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
  assert.doesNotMatch(prompt, /(^|[^A-Za-z0-9_])request_user_input([^A-Za-z0-9_]|$)/);
  assert.doesNotMatch(prompt, /structured input unavailable/);
  assert.match(prompt, /같은 질문을 prose\/번호 목록으로 대신 출력하지 말고 중단/);
  assert.match(prompt, /이번 주에 가장 먼저 만나서 확인해볼 사람은 누구인가요/);
  assert.match(prompt, /이미 불편하게 해결하는 사람/);
  assert.match(prompt, /이미 돈이나 시간을 쓰는 사람/);
  assert.match(prompt, /아직 모르겠어요/);
  assert.match(prompt, /오늘은 정답이 아니라 이번 주 확인할 사람 1명/);
  assert.match(prompt, /Adaptive\/Personalized 인터뷰 규칙/);
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
      projectKind: "mac_app",
      likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
      stage: "prototype",
      evidence: ["README: Agentic30"],
      confidence: "high",
      suggestedFirstQuestion: "",
    },
  });

  assert.equal(input.toolName, "agentic30_request_user_input");
  assert.equal(input.title, "첫 사용자 확인");
  assert.equal(input.questions.length, 1);
  assert.equal(input.questions[0].allowFreeText, true);
  assert.equal(input.questions[0].textMode, "short");
  assert.match(input.questions[0].helperText, /README: Agentic30/);
  assert.match(input.questions[0].question, /AI 코딩 도구를 쓰는 개발자/);
  assert.match(input.questions[0].question, /이번 주에 가장 먼저 만나서 확인해볼 사람/);
  assert.deepEqual(
    input.questions[0].options.map((option) => option.label),
    ["AI 코딩 도구를 쓰는 개발자", "이미 불편하게 해결하는 사람", "이미 돈이나 시간을 쓰는 사람", "아직 모르겠어요"],
  );
  assert.equal(input.questions[0].options.at(-1).nextIntent, "unknown_find_candidates");
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
  assert.equal(input.questions[0].header, "지금 막힌 지점을 먼저 봅니다");
  assert.match(input.questions[0].helperText, /docs\/SHEET\.md/);
  assert.match(input.questions[0].helperText, /공개 글의 기록 열/);
  assert.match(input.questions[0].helperText, /답은 docs\/SHEET\.md에 저장/);
  assert.match(input.questions[0].question, /공개 기록 기준에서 가장 먼저 해결해야 할 문제/);
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

test("Codex design-system initial input shows concrete visual examples", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "designSystem");
  const input = initialIddStructuredInputForDoc(doc, { provider: "codex" });
  const question = input.questions[0];
  const descriptions = question.options.map((option) => option.description).join("\n");
  const prompt = buildIddDocumentPrompt(doc, { provider: "codex", workspaceRoot: "/workspace" });

  assert.equal(input.title, "화면 원칙 정하기");
  assert.match(question.question, /화면 원칙에서 가장 먼저 해결해야 할 문제/);
  assert.match(descriptions, /\[상단: 오늘 할 일\] -> \[본문: 질문\] -> \[하단: 다음 행동\]/);
  assert.match(descriptions, /\[질문\]  \[선택 A\] \[선택 B\] \[직접 입력\]/);
  assert.match(descriptions, /A: 업무형  B: 카드형  C: 대화형/);
  assert.match(prompt, /design-shotgun/);
  assert.match(prompt, /ASCII ART 와이어프레임/);
});

test("Codex ICP IDD initial input has a low-confidence fallback that does not require expertise", () => {
  const doc = BIP_REQUIRED_LOCAL_DOCS.find((item) => item.type === "icp");
  const input = initialIddStructuredInputForDoc(doc, { provider: "codex" });

  assert.match(input.questions[0].question, /만들게 된 계기/);
  assert.match(input.questions[0].question, /이번 주에 확인해볼 사람/);
  assert.match(input.questions[0].helperText, /단정할 근거가 부족/);
  assert.deepEqual(
    input.questions[0].options.map((option) => option.label),
    ["나 또는 우리 팀", "이미 불편하게 해결하는 사람", "이미 돈이나 시간을 쓰는 사람", "아직 모르겠어요"],
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

  assert.match(input.questions[0].question, /README를 보면/);
  assert.match(input.questions[0].question, /이게 진짜 문제인지/);
  assert.doesNotMatch(input.questions[0].question, /단서가 보여요/);
});

test("IDD continuation prompt carries structured response and prevents repeating first ICP question", () => {
  const prompt = buildIddContinuationPrompt({
    iddPrompt: "IDD 문서 인터뷰를 시작합니다: ICP",
    structuredResponseText: "반복 사용 — B2B SaaS 창업팀",
  });

  assert.match(prompt, /이미 받은 첫 구조화 답변/);
  assert.match(prompt, /반복 사용 — B2B SaaS 창업팀/);
  assert.match(prompt, /같은 첫 고객 신호 질문을 반복하지 마세요/);
  assert.match(prompt, /현재 프로젝트의 실제 맥락에 맞춰 Adaptive\/Personalized 인터뷰/);
  assert.match(prompt, /README, docs, package\/config, 주요 소스, 최근 git 변경/);
  assert.match(prompt, /범용 질문이나 템플릿 질문/);
  assert.match(prompt, /decision brief/);
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
  assert.doesNotMatch(prompt, /(^|[^A-Za-z0-9_])request_user_input([^A-Za-z0-9_]|$)/);
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

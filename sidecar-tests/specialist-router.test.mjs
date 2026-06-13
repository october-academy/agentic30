import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpecialistInjection,
  classifyDecisionKind,
  describeAvailableSpecialists,
  detectPhase,
  PHASES,
  PLANNING_DOC_TYPES,
  selectSpecialist,
  selectSpecialistId,
} from "../sidecar/specialist-router.mjs";
import { buildDay30NoGoPrompt } from "../sidecar/specialists/plan-ceo-review.mjs";
import {
  SPECIALIST_IDS,
  buildSpecialistPrompt,
  getSpecialist,
  listSpecialistsByPhase,
} from "../sidecar/specialists/index.mjs";
import { RUBRIC_AXES } from "../sidecar/specialists/schema.mjs";
import {
  buildIddContinuationPrompt,
  buildIddDocumentPrompt,
} from "../sidecar/idd-doc-gate.mjs";
import { buildOfficeHoursDocsSystemPrompt } from "../sidecar/office-hours-docs-prompt.mjs";

const planningGate = {
  localDocs: [
    { type: "icp", found: false },
    { type: "goal", found: false },
    { type: "values", found: false },
    { type: "spec", found: false },
    { type: "designSystem", found: false },
    { type: "adr", found: false },
    { type: "docs", found: false },
    { type: "sheet", found: false },
  ],
};

const buildGate = {
  localDocs: [
    { type: "icp", found: true },
    { type: "goal", found: true },
    { type: "values", found: true },
    { type: "spec", found: true },
    { type: "designSystem", found: true },
    { type: "adr", found: true },
    { type: "docs", found: true },
    { type: "sheet", found: true },
  ],
};

test("9 specialists are registered with required fields", () => {
  assert.equal(SPECIALIST_IDS.length, 9);
  for (const id of SPECIALIST_IDS) {
    const entry = getSpecialist(id);
    assert.ok(entry, `missing entry for ${id}`);
    assert.ok(entry.name, `missing name for ${id}`);
    assert.ok(entry.summary, `missing summary for ${id}`);
    assert.ok(Array.isArray(entry.phases) && entry.phases.length > 0, `missing phases for ${id}`);
    assert.equal(typeof entry.build, "function");
    assert.ok(Array.isArray(entry.rubric), `missing rubric for ${id}`);
    assert.ok(entry.rubric.length >= 1 && entry.rubric.length <= 3, `rubric size out of range for ${id}`);
    for (const axis of entry.rubric) {
      assert.ok(RUBRIC_AXES.includes(axis), `unknown axis "${axis}" in ${id} rubric`);
    }
  }
  for (const expected of [
    "office-hours",
    "plan-ceo-review",
    "design-shotgun",
    "design-html",
    "plan-devex-review",
    "devex-review",
    "design-review",
    "plan-design-review",
    "design-consultation",
  ]) {
    assert.ok(SPECIALIST_IDS.includes(expected), `missing specialist ${expected}`);
  }
});

test("planning phase fires when any of ICP/GOAL/VALUES/SPEC is missing", () => {
  assert.equal(detectPhase({ bipSetupGate: planningGate }), PHASES.PLANNING);
  const partial = {
    localDocs: planningGate.localDocs.map((doc) =>
      doc.type === "icp" ? { ...doc, found: true } : doc,
    ),
  };
  assert.equal(detectPhase({ bipSetupGate: partial }), PHASES.PLANNING);
  assert.equal(detectPhase({ bipSetupGate: buildGate }), PHASES.BUILD);
});

test("PLANNING_DOC_TYPES is the single source of truth for phase gating", () => {
  assert.deepEqual([...PLANNING_DOC_TYPES].sort(), ["goal", "icp", "spec", "values"]);
});

test("planning-phase ICP routes to office-hours", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  assert.equal(selection.id, "office-hours");
  assert.equal(selection.phase, "planning");
  assert.equal(selection.decisionKind, "customer");
  assert.match(selection.promptText, /Office Hours \(YC\)/);
  assert.match(selection.reason, /planning phase/);
});

test("explicit office-hours command routes to office-hours specialist", () => {
  assert.equal(
    classifyDecisionKind({ promptText: "/office-hours" }),
    "customer",
  );
  assert.equal(
    classifyDecisionKind({ promptText: "/office-hours customer context" }),
    "customer",
  );
  assert.notEqual(
    classifyDecisionKind({ promptText: "/office-hours-docs" }),
    "customer",
  );

  const selection = selectSpecialist({
    bipSetupGate: buildGate,
    promptText: "/office-hours",
    lastAnswer: "Office Hours",
  });
  assert.equal(selection.id, "office-hours");
  assert.equal(selection.decisionKind, "customer");
  assert.equal(selection.vendor.codex.exists, true);
  assert.equal(selection.vendor.claude.exists, true);
});

test("planning-phase SPEC/GOAL/VALUES routes to plan-ceo-review", () => {
  for (const docType of ["spec", "goal", "values"]) {
    const selection = selectSpecialist({
      bipSetupGate: planningGate,
      doc: { type: docType, title: docType.toUpperCase() },
    });
    assert.equal(selection.id, "plan-ceo-review", `expected plan-ceo-review for ${docType}`);
  }
});

test("build-phase visual design keyword routes to design-review", () => {
  const selection = selectSpecialist({
    bipSetupGate: buildGate,
    lastAnswer: "스크린샷에서 위계가 깨져 보여요",
  });
  assert.equal(selection.id, "design-review");
  assert.equal(selection.phase, "build");
});

test("build-phase devex audit keyword routes to devex-review", () => {
  const selection = selectSpecialist({
    bipSetupGate: buildGate,
    lastAnswer: "직접 따라 해보니 첫 5분에서 막혔어요",
  });
  assert.equal(selection.id, "devex-review");
});

test("build-phase HTML/token keyword routes to design-html", () => {
  const selection = selectSpecialist({
    bipSetupGate: buildGate,
    lastAnswer: "이 디자인을 HTML 토큰으로 굳히고 싶어요",
  });
  assert.equal(selection.id, "design-html");
});

test("build-phase design plan/score keyword routes to plan-design-review", () => {
  const selection = selectSpecialist({
    bipSetupGate: buildGate,
    lastAnswer: "디자인 점수를 차원별로 매기고 싶어요",
  });
  assert.equal(selection.id, "plan-design-review");
});

test("design-system doc routes to design-consultation in build phase", () => {
  const selection = selectSpecialist({
    bipSetupGate: buildGate,
    doc: { type: "designSystem", title: "Design System" },
  });
  assert.equal(selection.id, "design-consultation");
});

test("docs doc routes to plan-devex-review by default", () => {
  const selection = selectSpecialist({
    bipSetupGate: buildGate,
    doc: { type: "docs", title: "Docs" },
  });
  assert.equal(selection.id, "plan-devex-review");
});

test("classifyDecisionKind picks design-direction from shotgun keywords", () => {
  assert.equal(
    classifyDecisionKind({ lastAnswer: "여러 시안 후보 비교가 필요해" }),
    "design-direction",
  );
  assert.equal(
    classifyDecisionKind({ lastAnswer: "design 후보가 부족해" }),
    "design-direction",
  );
});

test("selectSpecialistId falls back to office-hours when planning intent is unclear", () => {
  assert.equal(
    selectSpecialistId({ phase: "planning", decisionKind: "unknown-kind" }),
    "office-hours",
  );
});

test("selectSpecialistId in build phase falls back to design-review without other hints", () => {
  assert.equal(
    selectSpecialistId({ phase: "build", decisionKind: "unknown-kind" }),
    "design-review",
  );
});

const NO_VENDOR = { claude: { exists: false }, codex: { exists: false } };

test("buildSpecialistInjection embeds id, phase, decision and prompt body (fallback path)", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const injection = buildSpecialistInjection({ ...selection, vendor: NO_VENDOR });
  assert.match(injection, /Auto-routed specialist: Office Hours \(YC\) \(office-hours\)/);
  assert.match(injection, /Phase: planning/);
  assert.match(injection, /Decision: customer/);
  assert.match(injection, /Demand reality/);
  assert.match(injection, /사용자에게 specialist 이름을 알리지 마세요/);
});

test("buildSpecialistInjection always includes inline decision contract", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const injection = buildSpecialistInjection(selection);
  // INLINE_DECISION_CONTRACT is always injected so LLMs emit inline_decision
  // payloads instead of plain-text numbered lists.
  assert.match(injection, /Inline decision contract/);
  // Vendor-aware specialist routing block is only injected on the fallback path.
  if (selection.vendor.claude.exists && selection.vendor.codex.exists) {
    assert.doesNotMatch(injection, /Auto-routed specialist/);
  } else {
    assert.match(injection, /Auto-routed specialist/);
  }
});

test("selectSpecialist returns selection with vendor field for both providers", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  assert.ok(selection.vendor);
  assert.ok(typeof selection.vendor.claude === "object");
  assert.ok(typeof selection.vendor.codex === "object");
  assert.equal(typeof selection.vendor.claude.exists, "boolean");
  assert.equal(typeof selection.vendor.codex.exists, "boolean");
});

test("buildSpecialistInjection returns the inline decision contract for null selection", () => {
  // Even without a routed specialist, the inline_decision contract is still
  // injected so LLMs never fall back to plain-text numbered lists.
  const result = buildSpecialistInjection(null);
  assert.match(result, /Inline decision contract/);
  assert.doesNotMatch(result, /Auto-routed specialist/);
  assert.doesNotMatch(result, /rubric_focus/);
});

const VENDOR_BOTH = { claude: { exists: true }, codex: { exists: true } };

test("buildSpecialistInjection injects rubric guidance on the vendor-skill path", () => {
  // Even when the vendor SKILL.md drives content (and selection.promptText is
  // intentionally dropped), Agentic30's local question-quality contract and
  // alignment rubric instruction must survive so the response carries a sharp
  // decision card without leaking internal rubric metadata to the user.
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const injection = buildSpecialistInjection({ ...selection, vendor: VENDOR_BOTH });
  assert.match(injection, /Agentic30 question quality contract/);
  assert.match(injection, /One question = one decision/);
  assert.match(injection, /AskUserQuestion/);
  assert.match(injection, /request_user_input/);
  assert.match(injection, /2-4개 후보/);
  assert.match(injection, /제품 이름, 대상 유저, 해결 문제, 제품 목적/);
  assert.match(injection, /실제 이름, 역할, 상황/);
  assert.match(injection, /수요 증거, 현재 대안, 실제 사람, 가장 작은 wedge/);
  assert.match(injection, /clout/, "office-hours rubric clout axis missing");
  assert.match(injection, /Alignment rubric/);
  assert.match(injection, /metadata 키를 사용자-facing 답변에 출력하지 않는다/);
  assert.doesNotMatch(injection, /rubric_focus/);
  // Regression guard: vendor path must NOT echo the inline buildPrompt body.
  assert.doesNotMatch(injection, /Demand reality/);
  assert.doesNotMatch(injection, /Auto-routed specialist/);
});

test("buildSpecialistInjection injects rubric guidance on the fallback path", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const injection = buildSpecialistInjection({ ...selection, vendor: NO_VENDOR });
  assert.match(injection, /Agentic30 question quality contract/);
  assert.match(injection, /clout/);
  assert.doesNotMatch(injection, /rubric_focus/);
  // Fallback path keeps both the auto-routed header and the rubric block.
  assert.match(injection, /Auto-routed specialist/);
});

test("selectSpecialist exposes the rubric axes from the catalog entry", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  assert.ok(Array.isArray(selection.rubric));
  assert.deepEqual(selection.rubric, ["clout"]);
});

test("listSpecialistsByPhase only returns matching specialists", () => {
  const planningOnes = listSpecialistsByPhase("planning").map((entry) => entry.id);
  assert.ok(planningOnes.includes("office-hours"));
  assert.ok(planningOnes.includes("plan-ceo-review"));
  assert.ok(!planningOnes.includes("design-html"));

  const buildOnes = listSpecialistsByPhase("build").map((entry) => entry.id);
  assert.ok(buildOnes.includes("design-review"));
  assert.ok(buildOnes.includes("plan-devex-review"));
});

test("describeAvailableSpecialists exposes id, name, phases and summary only", () => {
  const list = describeAvailableSpecialists();
  assert.equal(list.length, 9);
  for (const entry of list) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["id", "name", "phases", "summary"],
    );
  }
});

test("buildSpecialistPrompt produces non-empty Korean prompt text for every specialist", () => {
  for (const id of SPECIALIST_IDS) {
    const text = buildSpecialistPrompt(id, {
      doc: { title: "ICP", type: "icp" },
      observations: "README mentions Mac assistant",
      lastAnswer: "first-time test answer",
    });
    assert.ok(text && text.length > 200, `prompt for ${id} too short`);
    assert.match(text, /Specialist 모드/);
  }
});

test("buildIddDocumentPrompt without specialistInjection keeps legacy gstack benchmark lines", () => {
  const prompt = buildIddDocumentPrompt(
    { type: "icp", title: "ICP", canonicalPath: ".agentic30/docs/ICP.md", focus: "ideal customer profile" },
    { provider: "claude", workspaceRoot: "/tmp" },
  );
  assert.match(prompt, /gstack office-hours 벤치마크/);
  assert.doesNotMatch(prompt, /Auto-routed specialist 모드/);
});

test("buildIddDocumentPrompt with specialistInjection swaps in the routed specialist block (fallback path)", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const prompt = buildIddDocumentPrompt(
    { type: "icp", title: "ICP", canonicalPath: ".agentic30/docs/ICP.md", focus: "ideal customer profile" },
    {
      provider: "claude",
      workspaceRoot: "/tmp",
      specialistInjection: buildSpecialistInjection({ ...selection, vendor: NO_VENDOR }),
    },
  );
  assert.match(prompt, /Auto-routed specialist: Office Hours \(YC\)/);
  assert.match(prompt, /라우팅된 specialist 모드의 사고 방식을 그대로 한 가지 질문으로/);
  assert.doesNotMatch(prompt, /gstack office-hours 벤치마크/);
});

test("buildIddContinuationPrompt with specialistInjection replaces the four inline gstack tactic lines (fallback path)", () => {
  const selection = selectSpecialist({
    bipSetupGate: buildGate,
    doc: { type: "designSystem", title: "Design System" },
  });
  const prompt = buildIddContinuationPrompt({
    iddPrompt: "ORIGINAL_IDD_PROMPT",
    structuredResponseText: "사용자 답변",
    specialistInjection: buildSpecialistInjection({ ...selection, vendor: NO_VENDOR }),
  });
  assert.match(prompt, /ORIGINAL_IDD_PROMPT/);
  assert.match(prompt, /사용자 답변/);
  assert.match(prompt, /Design Consultation/);
  assert.doesNotMatch(prompt, /office-hours 방식/);
  assert.doesNotMatch(prompt, /devex-review 방식/);
});

test("buildOfficeHoursDocsSystemPrompt accepts and embeds specialistInjection (fallback path)", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const sys = buildOfficeHoursDocsSystemPrompt("/tmp/workspace", {
    specialistInjection: buildSpecialistInjection({ ...selection, vendor: NO_VENDOR }),
  });
  assert.match(sys, /Auto-routed specialist mode/);
  assert.match(sys, /Office Hours \(YC\)/);
  assert.match(sys, /Office Hours document strategist/);
});

test("buildOfficeHoursDocsSystemPrompt without injection stays backward-compatible", () => {
  const sys = buildOfficeHoursDocsSystemPrompt("/tmp/workspace");
  assert.doesNotMatch(sys, /Auto-routed specialist mode/);
  assert.match(sys, /Office Hours document strategist/);
});

const VENDOR_CLAUDE_ONLY = { claude: { exists: true }, codex: { exists: false } };
const VENDOR_CODEX_ONLY = { claude: { exists: false }, codex: { exists: true } };

test("buildSpecialistInjection({provider:'claude'}) takes vendor path when only claude vendor exists", () => {
  // Codex MEDIUM review: when only the running provider's SKILL.md exists, the
  // vendor path must still kick in so the running prompt is not duplicated by
  // both the vendored SKILL and the inline fallback body.
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const injection = buildSpecialistInjection(
    { ...selection, vendor: VENDOR_CLAUDE_ONLY },
    { provider: "claude" },
  );
  assert.doesNotMatch(injection, /Auto-routed specialist/);
  assert.doesNotMatch(injection, /Demand reality/);
  assert.match(injection, /Alignment rubric/);
  assert.doesNotMatch(injection, /rubric_focus/);
});

test("buildSpecialistInjection({provider:'codex'}) takes vendor path when only codex vendor exists", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const injection = buildSpecialistInjection(
    { ...selection, vendor: VENDOR_CODEX_ONLY },
    { provider: "codex" },
  );
  assert.doesNotMatch(injection, /Auto-routed specialist/);
  assert.doesNotMatch(injection, /Demand reality/);
  assert.match(injection, /Alignment rubric/);
  assert.doesNotMatch(injection, /rubric_focus/);
});

test("buildSpecialistInjection({provider:'claude'}) falls back when only codex vendor exists", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const injection = buildSpecialistInjection(
    { ...selection, vendor: VENDOR_CODEX_ONLY },
    { provider: "claude" },
  );
  assert.match(injection, /Auto-routed specialist/);
  assert.match(injection, /Demand reality/);
});

test("buildDay30NoGoPrompt uses 지속/전환/중단 (Korean coaching tone), not Go/Kill/Pivot", () => {
  // Gemini UX: "Go/Kill/Pivot"은 한국어 사용자에게 공격적. Command 5점
  // anchor와 일치시키되 톤은 코칭으로 바꾼다.
  const prompt = buildDay30NoGoPrompt({
    rubricStatus: {
      dayZero: null,
      dayThirty: {
        day: 30,
        axes: {
          definition: { score: 4, anchor_level: 3, anchor_text: "..." },
          command: { score: 3, anchor_level: 3, anchor_text: "..." },
          clout: {
            score: 2,
            anchor_level: 1,
            anchor_text: "...",
            no_evidence_reason: "BIP 게시 0편",
          },
          responsibility: { score: 3, anchor_level: 3, anchor_text: "..." },
          adaptability: { score: 2, anchor_level: 1, anchor_text: "..." },
        },
      },
      delta: null,
    },
  });
  assert.ok(prompt, "Day 30 prompt must not be null when dayThirty exists");
  assert.equal(prompt.promptKey, "day30_no_go_decision");
  assert.equal(prompt.options.length, 3);
  const labels = prompt.options.map((o) => o.label).join(" ");
  assert.match(labels, /지속/);
  assert.match(labels, /전환/);
  assert.match(labels, /중단/);
  // Regression guard against the old aggressive phrasing.
  assert.doesNotMatch(prompt.body + labels, /Go *\/ *Kill *\/ *Pivot/i);
});

test("buildDay30NoGoPrompt asks each option for a one-line nextAction (post-decision blank guard)", () => {
  // Gemini: 결정 직후의 '공백' 차단. 각 option이 다음 한 줄 행동을 받아 다음
  // cycle의 시작점이 되도록.
  const prompt = buildDay30NoGoPrompt({
    rubricStatus: {
      dayZero: null,
      dayThirty: {
        day: 30,
        axes: {
          definition: { score: 1, anchor_level: 1, anchor_text: "..." },
          command: { score: 1, anchor_level: 1, anchor_text: "..." },
          clout: { score: 1, anchor_level: 1, anchor_text: "..." },
          responsibility: { score: 1, anchor_level: 1, anchor_text: "..." },
          adaptability: { score: 1, anchor_level: 1, anchor_text: "..." },
        },
      },
      delta: null,
    },
  });
  for (const option of prompt.options) {
    assert.ok(
      typeof option.nextActionPlaceholder === "string"
        && option.nextActionPlaceholder.length > 0,
      `option ${option.key} missing nextActionPlaceholder`,
    );
  }
});

test("buildDay30NoGoPrompt returns null gracefully when dayThirty is missing", () => {
  // 사용자가 Day 30 record를 아직 쌓지 않았을 때 prompt를 강제로 surface하지
  // 않는다. 호출처는 null을 받으면 prompt를 띄우지 않는다.
  assert.equal(buildDay30NoGoPrompt({ rubricStatus: null }), null);
  assert.equal(buildDay30NoGoPrompt({ rubricStatus: { dayThirty: null } }), null);
  assert.equal(buildDay30NoGoPrompt({}), null);
});

test("buildSpecialistInjection without provider keeps both-vendor requirement (back-compat)", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const onlyClaude = buildSpecialistInjection({ ...selection, vendor: VENDOR_CLAUDE_ONLY });
  // Without provider hint, the conservative rule (both vendors must exist) is
  // preserved so existing call sites in sidecar/index.mjs keep their behavior.
  assert.match(onlyClaude, /Auto-routed specialist/);
});

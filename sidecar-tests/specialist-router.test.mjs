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
import {
  SPECIALIST_IDS,
  buildSpecialistPrompt,
  getSpecialist,
  listSpecialistsByPhase,
} from "../sidecar/specialists/index.mjs";
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

test("buildSpecialistInjection embeds id, phase, decision and prompt body", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const injection = buildSpecialistInjection(selection);
  assert.match(injection, /Auto-routed specialist: Office Hours \(YC\) \(office-hours\)/);
  assert.match(injection, /Phase: planning/);
  assert.match(injection, /Decision: customer/);
  assert.match(injection, /Demand reality/);
  assert.match(injection, /사용자에게 specialist 이름을 알리지 마세요/);
});

test("buildSpecialistInjection returns empty string for null selection", () => {
  assert.equal(buildSpecialistInjection(null), "");
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
    { type: "icp", title: "ICP", canonicalPath: "docs/ICP.md", focus: "ideal customer profile" },
    { provider: "claude", workspaceRoot: "/tmp" },
  );
  assert.match(prompt, /gstack office-hours 벤치마크/);
  assert.doesNotMatch(prompt, /Auto-routed specialist 모드/);
});

test("buildIddDocumentPrompt with specialistInjection swaps in the routed specialist block", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const prompt = buildIddDocumentPrompt(
    { type: "icp", title: "ICP", canonicalPath: "docs/ICP.md", focus: "ideal customer profile" },
    {
      provider: "claude",
      workspaceRoot: "/tmp",
      specialistInjection: buildSpecialistInjection(selection),
    },
  );
  assert.match(prompt, /Auto-routed specialist: Office Hours \(YC\)/);
  assert.match(prompt, /라우팅된 specialist 모드의 사고 방식을 그대로 한 가지 질문으로/);
  assert.doesNotMatch(prompt, /gstack office-hours 벤치마크/);
});

test("buildIddContinuationPrompt with specialistInjection replaces the four inline gstack tactic lines", () => {
  const selection = selectSpecialist({
    bipSetupGate: buildGate,
    doc: { type: "designSystem", title: "Design System" },
  });
  const prompt = buildIddContinuationPrompt({
    iddPrompt: "ORIGINAL_IDD_PROMPT",
    structuredResponseText: "사용자 답변",
    specialistInjection: buildSpecialistInjection(selection),
  });
  assert.match(prompt, /ORIGINAL_IDD_PROMPT/);
  assert.match(prompt, /사용자 답변/);
  assert.match(prompt, /Design Consultation/);
  assert.doesNotMatch(prompt, /office-hours 방식/);
  assert.doesNotMatch(prompt, /devex-review 방식/);
});

test("buildOfficeHoursDocsSystemPrompt accepts and embeds specialistInjection", () => {
  const selection = selectSpecialist({
    bipSetupGate: planningGate,
    doc: { type: "icp", title: "ICP" },
  });
  const sys = buildOfficeHoursDocsSystemPrompt("/tmp/workspace", {
    specialistInjection: buildSpecialistInjection(selection),
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

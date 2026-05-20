import test from "node:test";
import assert from "node:assert/strict";
import {
  FOUNDATION_DAYS,
  buildFirstPromptForDay,
  buildFoundationSystemContext,
  formatFirstPromptText,
  getFoundationDay,
  resolveFoundationContext,
} from "../sidecar/foundation-chat.mjs";
import {
  buildFoundationAntiDisplacementGate,
  buildFoundationFrictionLogTemplate,
} from "../sidecar/foundation-contracts.mjs";

// Sub-AC 2.2 contract:
//   sidecar/index.mjs imports `buildFirstPromptForDay` from foundation-chat.mjs
//   and exposes it via the `foundation_first_prompt` WebSocket case. These
//   tests pin the underlying generator's contract so the WS handler stays
//   honest:
//     - Day 0/2-7 templates. Day 1 uses the OpenDesign Day page instead of a
//       chat opener.
//     - 3-section minimal (yesterday / today / question) — Agentic30
//       FoundationPhase ontology `first_prompt` shape.
//     - YC 파트너 톤: 반말 어미 (~어/야) only, no 정서 sugar (좋아요/괜찮아요/etc).
//     - Dynamic variables substitute when supplied; missing variables fall
//       back to a non-inventing placeholder (KR4.1/4.2 evidence integrity).
//     - The 3-section text fingerprint is stable for dedup / telemetry.

const PERSONA = "YC 파트너 / 시니어 메이커 (직설+압박, 반말 ~어/야)";
const MISSING = "(아직 데이터 없음)";
const FIRST_PROMPT_DAYS = Object.freeze([0, 2, 3, 4, 5, 6, 7]);

// Forbidden 정서적 지지 sugar — appearing in any first_prompt would violate
// the YC partner tone contract (Constraints: "정서적 지지 sugar 추가 금지").
const FORBIDDEN_SUGAR = [
  "괜찮아",
  "괜찮습니다",
  "잘하고 있어",
  "잘하고 있습니다",
  "수고했어",
  "고생했어",
  "고생했습니다",
  "감사합니다",
  "감사해요",
  "응원",
  "화이팅",
  "파이팅",
  "힘내",
  "걱정 마",
];

// Forbidden 문어체/존대 어미 — task constraint says "어미 문어체화 금지
// (반말 그대로 ~어/야)". We BAN ~습니다/~입니다/~해요/~예요/~에요 as
// sentence-final forms in any section (the real failure mode for this tone).
// Detecting valid 반말 is harder because Korean uses ~아/어/야/해 depending
// on the verb stem (e.g. "박아", "물어볼 거야", "써", "다시 짜"), so we don't
// require a per-section 반말 marker. Instead we require the FULL prompt to
// contain at least one explicit 반말 token.
const PANMAL_TOKENS = [
  "어?",
  "야?",
  "야.",
  "야 ",
  "어.",
  "어 ",
  "해?",
  "해.",
  "해 ",
  "아.", // 박아./짜./써. etc — common imperative ending
  "아 ",
  "거야",
  "어야",
  "건데",
];

test("FOUNDATION_DAYS map exposes exactly Day 0..7 (8 days, no gaps)", () => {
  const keys = Object.keys(FOUNDATION_DAYS)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  assert.deepEqual(keys, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("Day 0/2-7 have a 3-section minimal first_prompt; Day 1 uses OpenDesign", () => {
  for (const day of FIRST_PROMPT_DAYS) {
    const descriptor = getFoundationDay(day);
    assert.ok(descriptor, `Day ${day} must have a descriptor`);
    assert.ok(descriptor.first_prompt, `Day ${day} must have first_prompt`);
    const fp = descriptor.first_prompt;
    assert.equal(typeof fp.yesterday, "string", `Day ${day} yesterday is string`);
    assert.equal(typeof fp.today, "string", `Day ${day} today is string`);
    assert.equal(typeof fp.question, "string", `Day ${day} question is string`);
    assert.ok(fp.yesterday.length > 0, `Day ${day} yesterday non-empty`);
    assert.ok(fp.today.length > 0, `Day ${day} today non-empty`);
    assert.ok(fp.question.length > 0, `Day ${day} question non-empty`);
  }
  assert.equal(getFoundationDay(1).first_prompt, undefined);
});

test("buildFirstPromptForDay returns the canonical envelope for Day 0/2-7", () => {
  for (const day of FIRST_PROMPT_DAYS) {
    const built = buildFirstPromptForDay({ day });
    assert.ok(built, `Day ${day} must build a first prompt`);
    assert.equal(built.day, day);
    assert.equal(built.persona, PERSONA);
    assert.equal(built.template, "3-section minimal");
    assert.equal(typeof built.yesterday, "string");
    assert.equal(typeof built.today, "string");
    assert.equal(typeof built.question, "string");
    assert.equal(typeof built.core_question, "string");
    assert.ok(Array.isArray(built.artifacts));
    if (day === 0) {
      assert.equal(built.value_contract, null);
    } else {
      assert.equal(typeof built.value_contract?.todayValue, "string");
      assert.equal(typeof built.value_contract?.evidenceArtifact, "string");
      assert.equal(typeof built.value_contract?.passGate, "string");
      assert.equal(typeof built.value_contract?.failGate, "string");
      assert.ok(Array.isArray(built.value_contract?.canonicalDocs));
      assert.ok(built.value_contract.canonicalDocs.every((entry) => /^docs\/(ICP|VALUES|GOAL|SPEC)\.md$/.test(entry.path)));
      assert.match(built.value_contract?.resourceObservationPrompt || "", /자료|예시|템플릿/);
      assert.match(built.value_contract?.antiDisplacementGate?.rule || "", /hotfix|dogfood/);
    }
    assert.equal(typeof built.text, "string");
    // spec_version must match the Day -> SPEC vN contract
    const expectedSpec = FOUNDATION_DAYS[day].spec_version ?? null;
    assert.equal(built.spec_version, expectedSpec);
    // sub_workflow may be null but never invented
    const expectedSub = FOUNDATION_DAYS[day].sub_workflow ?? null;
    assert.equal(built.sub_workflow, expectedSub);
  }
});

test("buildFirstPromptForDay returns null for out-of-range days", () => {
  assert.equal(buildFirstPromptForDay({ day: -1 }), null);
  assert.equal(buildFirstPromptForDay({ day: 8 }), null);
  assert.equal(buildFirstPromptForDay({ day: 30 }), null);
  assert.equal(buildFirstPromptForDay({ day: null }), null);
  assert.equal(buildFirstPromptForDay({ day: undefined }), null);
  assert.equal(buildFirstPromptForDay({ day: "abc" }), null);
  assert.equal(buildFirstPromptForDay({}), null);
  assert.equal(buildFirstPromptForDay({ day: 1 }), null);
});

test("buildFirstPromptForDay coerces string day inputs", () => {
  // Swift sends Int → JSON serializer may stringify; sidecar must accept.
  const built = buildFirstPromptForDay({ day: "3" });
  assert.ok(built);
  assert.equal(built.day, 3);
});

test("YC partner tone — no 정서적 지지 sugar across chat-opener days", () => {
  for (const day of FIRST_PROMPT_DAYS) {
    const built = buildFirstPromptForDay({ day });
    const haystack = `${built.yesterday}\n${built.today}\n${built.question}`;
    for (const phrase of FORBIDDEN_SUGAR) {
      assert.ok(
        !haystack.includes(phrase),
        `Day ${day} must not contain 정서 sugar "${phrase}". Got: ${haystack}`,
      );
    }
  }
});

test("YC partner tone — no 문어체/존대 어미 in any section, 반말 present overall", () => {
  // Per-section: no ~습니다/~입니다/~해요/~예요/~에요 (문어체/존대).
  // Whole-prompt: at least one explicit 반말 token must appear so the YC
  // tone cannot silently flatten into a noun-only telegram.
  for (const day of FIRST_PROMPT_DAYS) {
    const built = buildFirstPromptForDay({ day });
    for (const section of ["yesterday", "today", "question"]) {
      const text = built[section];
      assert.ok(
        !/(습니다|입니다|해요|예요|에요)([.?!\s]|$)/.test(text),
        `Day ${day} ${section} must not use 문어체/존대. Got: "${text}"`,
      );
    }
    const haystack = `${built.yesterday}\n${built.today}\n${built.question}`;
    const hasPanmal = PANMAL_TOKENS.some((tok) => haystack.includes(tok));
    assert.ok(
      hasPanmal,
      `Day ${day} prompt must contain at least one 반말 token. Got: ${haystack}`,
    );
  }
});

test("3-section minimal — each section is a single line (no \\n inside section)", () => {
  for (const day of FIRST_PROMPT_DAYS) {
    const built = buildFirstPromptForDay({ day });
    assert.ok(!built.yesterday.includes("\n"), `Day ${day} yesterday is 1 line`);
    assert.ok(!built.today.includes("\n"), `Day ${day} today is 1 line`);
    assert.ok(!built.question.includes("\n"), `Day ${day} question is 1 line`);
  }
});

test("Day 1 no longer builds a foundation_first_prompt", () => {
  const built = buildFirstPromptForDay({
    day: 1,
    dynamicVariables: {
      legacy_opener: "legacy opener",
    },
  });
  assert.equal(built, null);
});

test("Day 2 first_prompt substitutes weak_hypothesis_id", () => {
  const built = buildFirstPromptForDay({
    day: 2,
    dynamicVariables: { weak_hypothesis_id: "H-2" },
  });
  assert.ok(built.yesterday.includes("H-2"));
  assert.ok(!built.yesterday.includes("{weak_hypothesis_id}"));
});

test("Day 3 first_prompt substitutes validated_or_refuted + n_quotes", () => {
  const built = buildFirstPromptForDay({
    day: 3,
    dynamicVariables: {
      weak_hypothesis_id: "H-1",
      validated_or_refuted: "강화됐어",
      n_quotes: 7,
    },
  });
  assert.ok(built.yesterday.includes("H-1"));
  assert.ok(built.yesterday.includes("강화됐어"));
  assert.ok(built.yesterday.includes("7"));
});

test("Day 4 first_prompt substitutes weak_section + reason + n_quotes", () => {
  const built = buildFirstPromptForDay({
    day: 4,
    dynamicVariables: {
      n_quotes: 5,
      weak_section: "오퍼",
      reason: "가격 미정",
    },
  });
  assert.ok(built.yesterday.includes("5"));
  assert.ok(built.yesterday.includes("오퍼"));
  assert.ok(built.yesterday.includes("가격 미정"));
});

test("Day 5 first_prompt substitutes ad metrics + signal_strength", () => {
  const built = buildFirstPromptForDay({
    day: 5,
    dynamicVariables: {
      weak_section: "오퍼",
      impressions: 4200,
      clicks: 86,
      signups: 4,
      signal_strength: "약함",
    },
  });
  assert.ok(built.today.includes("4200"));
  assert.ok(built.today.includes("86"));
  assert.ok(built.today.includes("4"));
  assert.ok(built.today.includes("약함"));
});

test("Day 6 first_prompt references signal_strength from Day 5", () => {
  const built = buildFirstPromptForDay({
    day: 6,
    dynamicVariables: { signal_strength: "중간" },
  });
  assert.ok(built.yesterday.includes("중간"));
});

test("Day 7 first_prompt substitutes strong_section + weak_section_v3", () => {
  const built = buildFirstPromptForDay({
    day: 7,
    dynamicVariables: {
      strong_section: "통증",
      weak_section_v3: "monetization",
    },
  });
  assert.ok(built.yesterday.includes("통증"));
  assert.ok(built.yesterday.includes("monetization"));
});

test("Foundation system context includes the dogfood VALUE contract", () => {
  const context = resolveFoundationContext({
    day: 3,
    prompt: "Day 3 시작",
    workspace: { root: "/tmp/workspace", available_sources: ["interview", "bip", "work_log"] },
  });

  assert.match(context.value_contract.todayValue, /Mom Test/);
  assert.match(context.value_contract.externalLockIn, /캘린더/);

  const system = buildFoundationSystemContext(context);
  assert.match(system, /VALUE contract/);
  assert.match(system, /오늘 얻는 가치/);
  assert.match(system, /needed resource/);
  assert.match(system, /anti-displacement/);
  assert.match(system, /canonical docs evidence/);
  assert.match(system, /docs\/ICP\.md/);
  assert.match(system, /docs\/GOAL\.md/);
  assert.match(system, /docs\/SPEC\.md/);
  assert.match(system, /ICP 후보 최소 1명/);
  assert.doesNotMatch(system, /승연|송재진|조제표/);
});

test("Foundation friction log template captures value, pass/fail, churn, and needed resource", () => {
  const template = buildFoundationFrictionLogTemplate({ day: 1, date: "2026-05-11" });
  assert.match(template, /Day 1 Friction Log - 2026-05-11/);
  assert.match(template, /Today value:/);
  assert.match(template, /Pass gate:/);
  assert.match(template, /Fail gate:/);
  assert.match(template, /Canonical docs evidence/);
  assert.match(template, /docs\/ICP\.md/);
  assert.match(template, /docs\/SPEC\.md/);
  assert.match(template, /Would an external user churn here/);
  assert.match(template, /Needed resource/);
  assert.match(template, /자료|예시|템플릿/);
});

test("anti-displacement gate can be scoped without public dogfood-week constants", () => {
  const defaultGate = buildFoundationAntiDisplacementGate();
  assert.match(defaultGate.baselineCommand, /<dogfood-evidence-root>/);
  assert.match(defaultGate.weeklyCheck, /<week-start-date>/);
  assert.doesNotMatch(defaultGate.baselineCommand, /2026-05-11|october-academy-agentic30|dogfood-week/);
  assert.doesNotMatch(defaultGate.weeklyCheck, /2026-05-11|october-academy-agentic30|dogfood-week/);

  const scopedGate = buildFoundationAntiDisplacementGate({
    evidenceRoot: "~/.gstack/projects/example/dogfood-week",
    weekStartDate: "2026-05-11",
  });
  assert.match(scopedGate.baselineCommand, /~\/\.gstack\/projects\/example\/dogfood-week\/baseline-head\.txt/);
  assert.match(scopedGate.weeklyCheck, /2026-05-11/);
});

test("Missing dynamic variables fall back to placeholder (no invented values)", () => {
  // Sub-AC 2.2 + KR4.1/4.2: AI must not invent weak_hypothesis_id etc. when
  // data is absent. Day 2's template still uses the legacy placeholder so the
  // missing-fallback contract is exercised there.
  const built = buildFirstPromptForDay({ day: 2, dynamicVariables: {} });
  assert.ok(built.yesterday.includes(MISSING));
  assert.ok(!built.yesterday.includes("{weak_hypothesis_id}"));
});

test("Unknown variable keys outside the whitelist do not substitute", () => {
  const built = buildFirstPromptForDay({
    day: 2,
    dynamicVariables: { weak_hypothesis_id: "H-1", malicious: "<script>" },
  });
  assert.ok(!built.yesterday.includes("<script>"));
  assert.ok(!built.today.includes("<script>"));
  assert.ok(!built.question.includes("<script>"));
});

test("formatFirstPromptText fingerprint is stable + matches built.text", () => {
  for (const day of FIRST_PROMPT_DAYS) {
    const built = buildFirstPromptForDay({ day });
    const formatted = formatFirstPromptText(built);
    assert.equal(built.text, formatted);
    // Stable layout — three lines, each labeled. The chat surface relies on
    // this format both for rendering and for dedup hashing.
    const lines = formatted.split("\n");
    assert.equal(lines.length, 3, `Day ${day} text must have 3 lines`);
    assert.ok(lines[0].startsWith("어제: "), `Day ${day} line 1 starts "어제: "`);
    assert.ok(lines[1].startsWith("오늘: "), `Day ${day} line 2 starts "오늘: "`);
    assert.ok(lines[2].startsWith("Q: "), `Day ${day} line 3 starts "Q: "`);
  }
});

test("Day 0 first_prompt acknowledges the start (no 'yesterday' history)", () => {
  // Day 0 is special — there is no real "yesterday". The template still uses
  // the 어제 slot to set up the framing, but it must not invent prior work.
  const built = buildFirstPromptForDay({ day: 0 });
  // Must explicitly state 시작점 / 없어 / 처음 — i.e. acknowledge no prior day.
  assert.match(built.yesterday, /(시작|없어|처음|Day 0)/);
});

test("Day -> sub_workflow mapping matches the Foundation contract", () => {
  // Locks the Phase definition so future template edits cannot silently
  // mis-route a sub-workflow. Day 1 still has a Foundation descriptor, but no
  // first_prompt is built for it because the OpenDesign Day page owns that UX.
  const expected = {
    0: "bip-channel-register",
    1: "office-hours-docs",
    2: null,
    3: "office-hours-docs",
    4: null,
    5: "analyze-ads",
    6: "monetization-ask",
    7: "foundation-summary",
  };
  for (const [day, sub] of Object.entries(expected)) {
    const descriptor = FOUNDATION_DAYS[day];
    assert.equal(descriptor.sub_workflow ?? null, sub, `Day ${day} sub_workflow`);
  }
});

test("Day -> spec_version mapping matches v0/v1/v2/v3 SPEC.md contract", () => {
  const expected = {
    0: null,
    1: "v0",
    2: null,
    3: "v1",
    4: null,
    5: "v2",
    6: null,
    7: "v3",
  };
  for (const [day, ver] of Object.entries(expected)) {
    const descriptor = FOUNDATION_DAYS[day];
    assert.equal(descriptor.spec_version ?? null, ver, `Day ${day} spec_version`);
  }
});

test("artifacts list is a defensive copy (mutating return doesn't poison map)", () => {
  const built = buildFirstPromptForDay({ day: 2 });
  built.artifacts.push("polluted.md");
  const fresh = buildFirstPromptForDay({ day: 2 });
  assert.ok(!fresh.artifacts.includes("polluted.md"));
});

test("FOUNDATION_DAYS map + first_prompt template are frozen", () => {
  // Outer map is frozen so the Day 0..7 set cannot grow or be reassigned.
  // Each first_prompt is frozen so prompt strings cannot be mutated in
  // place — buildFirstPromptForDay() then defensively copies array fields
  // (verified separately in the artifacts-mutation test).
  assert.ok(Object.isFrozen(FOUNDATION_DAYS), "FOUNDATION_DAYS map is frozen");
  for (const day of FIRST_PROMPT_DAYS) {
    assert.ok(
      Object.isFrozen(FOUNDATION_DAYS[day].first_prompt),
      `Day ${day} first_prompt is frozen`,
    );
  }
});

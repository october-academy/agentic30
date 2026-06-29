import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficeHoursEffectorContext,
  buildOfficeHoursSecondOpinionPrompt,
  parseOfficeHoursSecondOpinion,
  OFFICE_HOURS_SECOND_OPINION_EXECUTION_MODE,
  OFFICE_HOURS_EFFECTOR_CONTEXT_HEADER,
  OFFICE_HOURS_EFFECTOR_CONTEXT_GUARD,
} from "../sidecar/office-hours-effector-context.mjs";

test("second-opinion runs through the read-only judge execution mode", () => {
  assert.equal(OFFICE_HOURS_SECOND_OPINION_EXECUTION_MODE, "judge_read_only");
});

test("buildOfficeHoursSecondOpinionPrompt asks for strict JSON with the four gstack fields", () => {
  const prompt = buildOfficeHoursSecondOpinionPrompt({
    goalType: "make_money",
    goalText: "첫 유료 결제 1건",
    problemStatement: "support lead가 Slack escalation을 놓친다",
    keyAnswers: ["현재 대안: 수동 모니터링", "후보: B2B support lead"],
    landscape: "유사 도구 3개 존재",
    premises: ["사람들이 돈을 낼 것이다"],
    codebaseContext: "Node sidecar + Swift shell",
  });

  assert.match(prompt, /independent technical advisor/);
  assert.match(prompt, /Return ONLY a single JSON object/);
  for (const field of ["steelman", "strongestSignal", "wrongPremise", "prototype48h"]) {
    assert.ok(prompt.includes(field), `prompt should request ${field}`);
  }
  // Context is woven in.
  assert.match(prompt, /make_money/);
  assert.match(prompt, /support lead가 Slack escalation을 놓친다/);
  assert.match(prompt, /현재 대안: 수동 모니터링/);
  // Korean output, terse, no preamble.
  assert.match(prompt, /Korean/);
  assert.match(prompt, /No preamble/);
});

test("parseOfficeHoursSecondOpinion reads a clean JSON object", () => {
  const raw = JSON.stringify({
    steelman: "가장 강한 버전입니다",
    strongestSignal: "현재 대안에 돈을 쓴다",
    wrongPremise: "모두가 원한다는 가정",
    prototype48h: "Slack 봇 하나",
  });
  const parsed = parseOfficeHoursSecondOpinion(raw);
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.steelman, "가장 강한 버전입니다");
  assert.equal(parsed.prototype48h, "Slack 봇 하나");
});

test("parseOfficeHoursSecondOpinion tolerates a fenced / prose-wrapped object", () => {
  const raw = "여기 결과입니다:\n```json\n{ \"steelman\": \"x\", \"strongestSignal\": \"y\", \"wrongPremise\": \"z\", \"prototype48h\": \"w\" }\n```\n끝.";
  const parsed = parseOfficeHoursSecondOpinion(raw);
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.steelman, "x");
  assert.equal(parsed.wrongPremise, "z");
});

test("parseOfficeHoursSecondOpinion is fail-open on empty / garbage / fieldless input", () => {
  assert.equal(parseOfficeHoursSecondOpinion("").status, "unavailable");
  assert.equal(parseOfficeHoursSecondOpinion("   ").status, "unavailable");
  assert.equal(parseOfficeHoursSecondOpinion("not json at all").status, "unavailable");
  assert.equal(parseOfficeHoursSecondOpinion("{}").status, "unavailable");
  assert.equal(parseOfficeHoursSecondOpinion("[1,2,3]").status, "unavailable");
});

test("buildOfficeHoursEffectorContext returns empty string when there is nothing to inject", () => {
  assert.equal(buildOfficeHoursEffectorContext(), "");
  assert.equal(buildOfficeHoursEffectorContext({}), "");
  assert.equal(buildOfficeHoursEffectorContext({ landscape: "", alternatives: [] }), "");
  assert.equal(buildOfficeHoursEffectorContext({ secondOpinion: null }), "");
});

test("buildOfficeHoursEffectorContext always leads with the read-only C-3 guard", () => {
  const context = buildOfficeHoursEffectorContext({ landscape: ["유사 도구 3개"] });
  assert.match(context, new RegExp(OFFICE_HOURS_EFFECTOR_CONTEXT_HEADER.replace(/[()]/g, "\\$&")));
  assert.ok(context.includes(OFFICE_HOURS_EFFECTOR_CONTEXT_GUARD));
  // C-3: the guard explicitly forbids turning this background into questions/cards.
  assert.match(context, /새 structured input 카드나 질문을 만들지 않는다/);
  // No structured-input card shape leaks (no generation/signalId machinery).
  assert.doesNotMatch(context, /generation\.signalId|signalLabel|allowFreeText/);
});

test("buildOfficeHoursEffectorContext renders landscape, external context, and alternatives", () => {
  const context = buildOfficeHoursEffectorContext({
    landscape: ["유사 도구 3개 존재", "가격대 월 2만원"],
    externalContext: "어제 결제 요청 화면 캡처 1건 기록됨",
    alternatives: ["최소안: 수동 알림", "이상안: 자동 파이프라인"],
  });
  assert.match(context, /시장 지형 \(landscape, 하루 1회 캐시\)/);
  assert.match(context, /유사 도구 3개 존재/);
  assert.match(context, /외부 맥락 \(Founder Replay \/ morning briefing\)/);
  assert.match(context, /어제 결제 요청 화면 캡처 1건 기록됨/);
  assert.match(context, /대안 후보/);
  assert.match(context, /카드 선택은 reducer/);
  assert.match(context, /최소안: 수동 알림/);
});

test("buildOfficeHoursEffectorContext renders an OK second opinion with all four fields", () => {
  const context = buildOfficeHoursEffectorContext({
    secondOpinion: {
      status: "ok",
      steelman: "강한 버전",
      strongestSignal: "돈을 쓰는 신호",
      wrongPremise: "틀린 전제",
      prototype48h: "봇 프로토타입",
    },
  });
  assert.match(context, /교차 모델 second opinion \(독립 관점\)/);
  assert.match(context, /가장 강한 버전: 강한 버전/);
  assert.match(context, /48시간 프로토타입 제안: 봇 프로토타입/);
});

test("buildOfficeHoursEffectorContext fails open on an unavailable second opinion (no fabrication)", () => {
  const context = buildOfficeHoursEffectorContext({
    secondOpinion: { status: "unavailable", reason: "unparseable" },
  });
  assert.match(context, /독립 모델 의견을 받지 못했다/);
  assert.match(context, /없는 second opinion을 있는 것처럼 인용하지 않는다/);
});

test("effector context preserves word spacing (NUL-byte regression in cleanText)", () => {
  const context = buildOfficeHoursEffectorContext({ landscape: ["가장 강한 버전 두 단어"] });
  assert.match(context, /가장 강한 버전 두 단어/);
  assert.doesNotMatch(context, /가장강한버전/);
});

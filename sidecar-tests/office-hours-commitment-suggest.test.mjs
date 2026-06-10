import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_COMMITMENT_CANDIDATES,
  buildOfficeHoursCommitmentCandidatesPrompt,
  parseOfficeHoursCommitmentCandidates,
  mergeCommitmentCandidates,
} from "../sidecar/office-hours-commitment-suggest.mjs";

test("buildPrompt embeds Q/A turns and demands strict JSON", () => {
  const prompt = buildOfficeHoursCommitmentCandidatesPrompt({
    turns: [
      { questionText: "누가 가장 desperate한가?", responseText: "이커머스 1인 운영자" },
      { questionText: "지금 그들은 무엇으로 때우나?", responseText: "수기 엑셀 + 알바" },
    ],
    openThreads: ["조은성에게 결제요청 보내기"],
    day: 6,
  });
  assert.match(prompt, /Day 6/);
  assert.match(prompt, /이커머스 1인 운영자/);
  assert.match(prompt, /수기 엑셀/);
  assert.match(prompt, /조은성에게 결제요청 보내기/);
  assert.match(prompt, /"candidates"/);
  // Anti-displacement framing must be present.
  assert.match(prompt, /코스튬은 금지/);
});

test("buildPrompt tolerates no turns without throwing", () => {
  const prompt = buildOfficeHoursCommitmentCandidatesPrompt({});
  assert.match(prompt, /이번 인터뷰 답변 기록 없음/);
  assert.match(prompt, /"candidates"/);
});

test("parse handles a clean JSON object", () => {
  const out = parseOfficeHoursCommitmentCandidates(
    '{"candidates": ["조은성에게 가격 5만원 결제요청 보내기", "박지민에게 데모 약속 잡기"]}',
  );
  assert.deepEqual(out, [
    "조은성에게 가격 5만원 결제요청 보내기",
    "박지민에게 데모 약속 잡기",
  ]);
});

test("parse strips a ```json fence and surrounding prose", () => {
  const out = parseOfficeHoursCommitmentCandidates(
    'Sure! Here you go:\n```json\n{"candidates": ["A 고객에게 전화하기"]}\n```\n',
  );
  assert.deepEqual(out, ["A 고객에게 전화하기"]);
});

test("parse accepts a bare array", () => {
  const out = parseOfficeHoursCommitmentCandidates('["첫 행동", "둘째 행동"]');
  assert.deepEqual(out, ["첫 행동", "둘째 행동"]);
});

test("parse accepts object-shaped candidates via label/text", () => {
  const out = parseOfficeHoursCommitmentCandidates(
    '{"candidates": [{"label": "라벨 액션"}, {"text": "텍스트 액션"}]}',
  );
  assert.deepEqual(out, ["라벨 액션", "텍스트 액션"]);
});

test("parse strips list markers and wrapping quotes", () => {
  const out = parseOfficeHoursCommitmentCandidates('["1. 첫째", "- 둘째", "“셋째”"]');
  assert.deepEqual(out, ["첫째", "둘째", "셋째"]);
});

test("parse dedupes case-insensitively and clamps to the max", () => {
  const out = parseOfficeHoursCommitmentCandidates(
    '["같은 행동", "같은 행동", "다른 행동", "또 다른", "넘치는 하나"]',
  );
  assert.equal(out.length, MAX_COMMITMENT_CANDIDATES);
  assert.deepEqual(out, ["같은 행동", "다른 행동", "또 다른"]);
});

test("parse returns [] for junk / empty / non-JSON", () => {
  assert.deepEqual(parseOfficeHoursCommitmentCandidates(""), []);
  assert.deepEqual(parseOfficeHoursCommitmentCandidates("죄송하지만 모르겠어요"), []);
  assert.deepEqual(parseOfficeHoursCommitmentCandidates(undefined), []);
  assert.deepEqual(parseOfficeHoursCommitmentCandidates('{"foo": "bar"}'), []);
});

test("parse clamps an over-long candidate", () => {
  const long = "가".repeat(200);
  const out = parseOfficeHoursCommitmentCandidates(JSON.stringify({ candidates: [long] }));
  assert.equal(out.length, 1);
  assert.ok(out[0].length <= 80);
  assert.ok(out[0].endsWith("…"));
});

test("merge prioritizes generated, then fallback, deduped + clamped", () => {
  const out = mergeCommitmentCandidates(
    ["생성 1", "생성 2"],
    ["생성 2", "메모리 폴백", "넘치는 폴백"],
  );
  assert.deepEqual(out, ["생성 1", "생성 2", "메모리 폴백"]);
});

test("merge tolerates empty sides", () => {
  assert.deepEqual(mergeCommitmentCandidates([], []), []);
  assert.deepEqual(mergeCommitmentCandidates([], ["폴백만"]), ["폴백만"]);
  assert.deepEqual(mergeCommitmentCandidates(["생성만"], []), ["생성만"]);
});
